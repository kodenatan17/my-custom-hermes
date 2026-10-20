#!/usr/bin/env node
// Write-lock demo: simulated Claude Code, Cline and OpenCode agents contend for features through the REAL
// coordinator on the live daemon (default ws://localhost:4777). Watch it in the visualizer HUD.
//
//   node .opencode/bridge/demo-locks.mjs [--fast]
//
// After the main scenario it runs two scenarios on a PRIVATE daemon (port 4791, liveSeconds=3) so real tools that
// are active on the live daemon cannot interfere: "solo" (Cline alone: no denial, no lock.* events) and "orphan"
// (a lock owner stops sending events; the next owner proceeds once liveSeconds has passed).
//
// Claude / Cline agents pipe real payloads into the real `hook.mjs`; OpenCode agents call emit.mjs claim()/release()
// exactly like plugins/office-bridge.ts. No files are written (paths are only strings). Exit code 1 if an assertion fails.
import { spawn } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { createHash, randomBytes } from "node:crypto"
import { request } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { claim, emit, release } from "./emit.mjs"

const PORT = Number(process.env.OFFICE_BRIDGE_PORT ?? 4777)
const BASE = `http://127.0.0.1:${PORT}`
const HERE = dirname(fileURLToPath(import.meta.url))
const HOOK = join(HERE, "hook.mjs")
const DAEMON = join(HERE, "daemon.mjs")
const PRIVATE_PORT = 4791
const FAST = process.argv.includes("--fast")
const S = FAST ? 0.5 : 1 // time scale for the scripted timeline
const CLAUDE_HOLD = FAST ? 4 : 10 // how long Claude keeps app_router (Cline's hook now WAITS on it up to 45s and is granted when Claude releases; never a cancel)
const OC_WORK = 2 * S

const GARDEN = "seedly_app/lib/features/garden/presentation/garden_page.dart"
const AUTH = "seedly_app/lib/features/auth/presentation/login_page.dart"
const ROUTER = "seedly_app/lib/cores/router/app_router.dart"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const t0 = Date.now()
const now = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5)
const say = (who, msg) => console.log(`[+${now()}s] ${who.padEnd(11)} ${msg}`)
const at = async (sec) => sleep(Math.max(0, t0 + sec * S * 1000 - Date.now()))

// ---------- WebSocket capture (raw RFC 6455 client, text frames only) ----------
const events = []
function connectWs(port = PORT, handler = (e) => onEvent(e)) {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString("base64")
    const req = request({ host: "127.0.0.1", port, headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Key": key, "Sec-WebSocket-Version": "13" } })
    req.on("error", reject)
    req.on("upgrade", (res, socket, head) => {
      const ok = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")
      if (res.headers["sec-websocket-accept"] !== ok) return reject(new Error("bad ws accept"))
      let buf = head
      socket.on("data", (c) => {
        buf = Buffer.concat([buf, c])
        for (;;) {
          if (buf.length < 2) return
          let len = buf[1] & 0x7f
          let off = 2
          if (len === 126) (len = buf.readUInt16BE(2)), (off = 4)
          else if (len === 127) (len = Number(buf.readBigUInt64BE(2))), (off = 10)
          if (buf.length < off + len) return
          const payload = buf.subarray(off, off + len)
          buf = buf.subarray(off + len)
          try {
            const e = JSON.parse(payload.toString("utf8"))
            if (e.type !== "hello") handler(e)
          } catch {}
        }
      })
      resolve(socket)
    })
    req.end()
  })
}

// Invariants derived from the event stream.
const holder = new Map() // feature -> {source, sessionID}
const violations = []
const grantOrder = { garden: [] }
const waitingEvents = []
function onEvent(e) {
  events.push({ ...e, at: (Date.now() - t0) / 1000 })
  if (!String(e.type).startsWith("lock.")) return
  const who = `${e.source}:${e.sessionID}`
  if (e.type === "lock.acquired") {
    const h = holder.get(e.feature)
    if (h && `${h.source}:${h.sessionID}` !== who) violations.push(`${e.feature} acquired by ${who} while held by ${h.source}:${h.sessionID}`)
    holder.set(e.feature, { source: e.source, sessionID: e.sessionID })
    if (e.feature === "garden") grantOrder.garden.push(who)
    say("bridge", `lock.acquired  ${e.feature} by ${who}`)
  } else if (e.type === "lock.released" || e.type === "lock.expired") {
    holder.delete(e.feature)
    say("bridge", `${e.type.padEnd(13)} ${e.feature} by ${who}`)
  } else if (e.type === "lock.waiting") {
    const h = holder.get(e.feature)
    waitingEvents.push({ who, feature: e.feature, waitingOn: e.waitingOn, expected: h })
    say("bridge", `lock.waiting   ${e.feature} ${who} -> waitingOn ${e.waitingOn?.source}:${e.waitingOn?.sessionID}`)
  }
}

// ---------- simulated agents ----------
function runHook(source, payload, env = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const p = spawn(process.execPath, [HOOK, source], { env: { ...process.env, OFFICE_HOOK_LOG: "/dev/null", ...env }, stdio: ["pipe", "pipe", "ignore"] })
    let out = ""
    p.stdout.on("data", (c) => (out += c))
    p.on("close", () => {
      let r = null
      try {
        r = out.trim() ? JSON.parse(out.trim()) : null
      } catch {}
      const denied = source === "cline" ? r?.cancel === true : r?.hookSpecificOutput?.permissionDecision === "deny"
      resolve({ denied, warned: typeof r?.context === "string", ms: Date.now() - startedAt, reason: r?.errorMessage ?? r?.hookSpecificOutput?.permissionDecisionReason })
    })
    p.stdin.end(JSON.stringify(payload))
  })
}

const stats = { denies: { cline: 0, claude: 0, opencode: 0 }, grantedAt: {}, clineWaitMs: {}, clineWarned: 0 }

const claudeAgent = (session) => ({
  name: "claude",
  pre: (tool, input) => runHook("claude", { hook_event_name: "PreToolUse", session_id: session, agent_type: "coder", tool_name: tool, tool_input: input }),
  edit: (path) => claudeAgent(session).pre("Edit", { file_path: path }),
  read: (path) => claudeAgent(session).pre("Read", { file_path: path }),
  start: () => runHook("claude", { hook_event_name: "SessionStart", session_id: session }),
  finish: () => runHook("claude", { hook_event_name: "Stop", session_id: session }),
})
const clineAgent = (task) => {
  const env = { SEEDLY_PHASE: "slicing" } // real Cline main agent is "orchestrator" (phase integration); forced so the demo shows the slicing phase
  const pre = (name, input) => runHook("cline", { hookName: "PreToolUse", taskId: task, tool_call: { name, input } }, env)
  return {
    name: "cline",
    edit: (path) => pre("write_to_file", { path }),
    read: (path) => pre("read_file", { path }),
    start: () => runHook("cline", { hookName: "TaskStart", taskId: task }, env),
    finish: () => runHook("cline", { hookName: "TaskComplete", taskId: task }, env),
  }
}

/** Edit that retries after a deny, like a real agent told "retry shortly". Returns when granted. */
async function editUntilGranted(agent, who, path) {
  say(who, `edit ${path.replace("seedly_app/lib/", "")}`)
  for (let n = 1; ; n++) {
    const r = await agent.edit(path)
    if (agent.name === "cline") {
      stats.clineWaitMs[path] = r.ms
      if (r.warned) stats.clineWarned++
    }
    if (!r.denied) {
      say(who, `GRANTED ${path.replace("seedly_app/lib/", "")}${n > 1 ? ` (after ${n - 1} deny/retry)` : ""}`)
      return
    }
    stats.denies[agent.name]++
    say(who, `DENIED  (${(r.reason ?? "").slice(0, 70)}) -> retry in 1s`)
    await sleep(1000)
  }
}

async function work(agent, who, seconds, path) {
  const end = Date.now() + seconds * 1000
  while (Date.now() < end) {
    await agent.read(path)
    await sleep(Math.min(1000, Math.max(0, end - Date.now())))
  }
}

async function cline() {
  const who = "cline"
  const a = clineAgent("demo-cline")
  await a.start()
  await at(0)
  await editUntilGranted(a, who, GARDEN)
  await work(a, who, 2.5 * S, GARDEN) // slicing garden
  await editUntilGranted(a, who, ROUTER) // shared file, Claude holds it
  await work(a, who, 2 * S, ROUTER)
  say(who, "TaskComplete -> release")
  await a.finish()
}

async function claude() {
  const who = "claude"
  const a = claudeAgent("demo-claude")
  await a.start()
  await at(1)
  const t = Date.now()
  await editUntilGranted(a, who, AUTH)
  stats.claudeAuthMs = Date.now() - t
  await work(a, who, 1 * S, AUTH)
  await at(2)
  await editUntilGranted(a, who, ROUTER)
  await work(a, who, CLAUDE_HOLD, ROUTER)
  say(who, "Stop -> release")
  await a.finish()
}

/** OpenCode: same calls as plugins/office-bridge.ts (claim with owner opencode:<root session>, max wait 20s). */
async function opencode(name, session, startAt, priority) {
  const who = name
  const owner = `opencode:${session}`
  await at(startAt)
  await emit({ type: "busy", agent: "qa", sessionID: session, source: "opencode", text: `opencode: ${name}` })
  say(who, `edit garden (priority=${priority}, phase=integration)`)
  for (let n = 1; ; n++) {
    const r = await claim({ owner, source: "opencode", sessionID: session, agent: "qa", path: GARDEN, priority, phase: "integration" }, 20_000)
    if (r.granted) {
      say(who, `GRANTED garden${n > 1 ? ` (after ${n - 1} deny/retry)` : ""}`)
      break
    }
    stats.denies.opencode++
    say(who, `DENIED (holder ${r.holder?.source}, pos ${r.queuePosition}) -> retry`)
    await sleep(1000)
  }
  const end = Date.now() + OC_WORK * 1000
  while (Date.now() < end) {
    await emit({ type: "activity", agent: "qa", sessionID: session, source: "opencode", text: "edit garden_page.dart" })
    await sleep(Math.min(1000, Math.max(0, end - Date.now())))
  }
  say(who, "done -> release")
  await release({ owner })
  await emit({ type: "idle", agent: "qa", sessionID: session, source: "opencode" })
}

// ---------- mutex poller ----------
let polling = true
const pollViolations = []
async function poll() {
  while (polling) {
    try {
      const j = await (await fetch(`${BASE}/locks`)).json()
      const seen = new Set()
      for (const l of j.locks) {
        if (seen.has(l.feature)) pollViolations.push(`duplicate holder record for ${l.feature}`)
        seen.add(l.feature)
      }
    } catch {}
    await sleep(200)
  }
}


// ---------- private-daemon scenarios ----------
async function withPrivateDaemon(liveSeconds, fn, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "demo-locks-"))
  const file = join(dir, "coordination.json")
  writeFileSync(file, JSON.stringify({ liveSeconds, ...extra }))
  const env = { ...process.env, OFFICE_BRIDGE_PORT: String(PRIVATE_PORT), OFFICE_COORDINATION: file }
  const child = spawn(process.execPath, [DAEMON], { env, stdio: "ignore" })
  const stop = () => child.kill("SIGKILL")
  process.on("exit", stop)
  try {
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${PRIVATE_PORT}/health`)).ok) break
      } catch {}
      await sleep(100)
    }
    const evs = []
    const ws = await connectWs(PRIVATE_PORT, (e) => evs.push(e))
    try {
      return await fn({ evs, env: { OFFICE_BRIDGE_PORT: String(PRIVATE_PORT) } })
    } finally {
      ws.destroy()
    }
  } finally {
    stop()
  }
}

async function soloScenario() {
  say("solo", "Cline alone on a private daemon: 6 write edits, expect zero denials and zero lock.* events")
  return withPrivateDaemon(120, async ({ evs, env }) => {
    const task = "solo-task"
    let denied = 0
    const t = Date.now()
    await runHook("cline", { hookName: "TaskStart", taskId: task }, env)
    for (const path of [GARDEN, AUTH, ROUTER, GARDEN, AUTH, ROUTER]) {
      const r = await runHook("cline", { hookName: "PreToolUse", taskId: task, tool_call: { name: "write_to_file", input: { path } } }, env)
      if (r.denied) denied++
    }
    await runHook("cline", { hookName: "TaskComplete", taskId: task }, env)
    await sleep(300)
    const lockEvents = evs.filter((e) => String(e.type).startsWith("lock."))
    const j = await (await fetch(`http://127.0.0.1:${PRIVATE_PORT}/locks`)).json()
    say("solo", `denied=${denied} lock events=${lockEvents.length} waiters=${j.waiters.length} in ${Date.now() - t}ms`)
    return { denied, lockEvents, waiters: j.waiters.length, ms: Date.now() - t }
  })
}

async function orphanScenario() {
  const LIVE = 3
  say("orphan", `Cline task 1 takes garden and dies silently; task 2 must proceed once liveSeconds=${LIVE}s passed`)
  return withPrivateDaemon(LIVE, async ({ evs, env }) => {
    const edit = (task) => runHook("cline", { hookName: "PreToolUse", taskId: task, tool_call: { name: "write_to_file", input: { path: GARDEN } } }, env)
    const first = await edit("orphan-1") // then no more events and no TaskComplete: the task crashed
    const t = Date.now()
    let denies = 0
    for (;;) {
      const r = await edit("orphan-2")
      if (!r.denied) break
      denies++
      await sleep(500)
      if (Date.now() - t > 15_000) break
    }
    const ms = Date.now() - t
    await sleep(300)
    const stale = evs.filter((e) => e.type === "lock.expired" && e.reason === "stale")
    const override = evs.filter((e) => e.type === "lock.override")
    say("orphan", `task 2 proceeded after ${ms}ms (denies=${denies}); stale expiries=${stale.length}`)
    return { firstDenied: first.denied, ms, stale: stale.length, override: override.length, done: ms <= 15_000 }
  })
}

async function supersedeScenario() {
  say("supersede", "Cline task 1 takes garden and crashes; task 2 TaskStart (liveSeconds=120, supersedeIdleSeconds=1) must proceed at once")
  return withPrivateDaemon(120, async ({ evs, env }) => {
    const edit = (task) => runHook("cline", { hookName: "PreToolUse", taskId: task, tool_call: { name: "write_to_file", input: { path: GARDEN } } }, env)
    const other = runHook("claude", { hook_event_name: "SessionStart", session_id: "sup-claude" }, env) // another live tool: locks are visible
    await other
    await edit("sup-1")
    await sleep(1600) // task 1 is now idle > supersedeIdleSeconds and never completes
    await runHook("claude", { hook_event_name: "PreToolUse", session_id: "sup-claude", tool_name: "Read", tool_input: { file_path: GARDEN } }, env)
    await runHook("cline", { hookName: "TaskStart", taskId: "sup-2" }, env)
    const t = Date.now()
    const r = await edit("sup-2")
    const ms = Date.now() - t
    await sleep(300)
    const sup = evs.filter((e) => e.type === "lock.expired" && e.reason === "superseded")
    const waiting = evs.filter((e) => e.type === "lock.waiting")
    say("supersede", `task 2 edit denied=${r.denied} in ${ms}ms; superseded expiries=${sup.length}`)
    return { denied: r.denied, ms, sup: sup.length, waiting: waiting.length }
  }, { supersedeIdleSeconds: 1 })
}

// ---------- main ----------
const results = []
const check = (name, ok, detail = "") => results.push({ name, ok, detail })

async function main() {
  try {
    const h = await (await fetch(`${BASE}/locks`)).json()
    if (h.ok !== true) throw new Error("no /locks")
    if (h.locks.length) console.log(`note: daemon already holds ${h.locks.length} lock(s); results may be affected`)
  } catch (e) {
    console.error(`daemon at ${BASE} missing /locks (old or down): ${e.message}`)
    process.exit(2)
  }
  const ws = await connectWs()
  say("demo", `connected to ws://localhost:${PORT}; open http://localhost:5173 to watch${FAST ? " (--fast)" : ""}`)
  const pollP = poll()
  const guard = setTimeout(() => {
    console.error("demo timed out")
    process.exit(3)
  }, 180_000)

  await Promise.all([
    cline(),
    claude(),
    opencode("opencode-A", "demo-oc-A", 1, "normal"),
    opencode("opencode-LOW", "demo-oc-LOW", 3, "low"),
    opencode("opencode-HIGH", "demo-oc-HIGH", 3.5, "high"),
  ])
  await sleep(500) // let trailing events arrive
  polling = false
  await pollP
  clearTimeout(guard)
  const final = await (await fetch(`${BASE}/locks`)).json()
  ws.destroy()
  const solo = await soloScenario()
  const orphan = await orphanScenario()
  const sup = await supersedeScenario()

  // ---- assertions ----
  check("mutual exclusion (events)", violations.length === 0, violations.join("; "))
  check("mutual exclusion (GET /locks every 200ms)", pollViolations.length === 0, pollViolations.join("; "))
  const want = ["cline:cline:demo-cline", "opencode:demo-oc-HIGH", "opencode:demo-oc-A", "opencode:demo-oc-LOW"]
  check("garden grant order cline > high > normal > low", JSON.stringify(grantOrder.garden) === JSON.stringify(want), grantOrder.garden.join(" > "))
  const expectWaits = {
    "opencode:demo-oc-A|garden": "cline:cline:demo-cline",
    "opencode:demo-oc-LOW|garden": "cline:cline:demo-cline",
    "opencode:demo-oc-HIGH|garden": "cline:cline:demo-cline",
    "cline:cline:demo-cline|_shared": "claude:claude:demo-claude",
  }
  const gotWaits = Object.fromEntries(waitingEvents.map((w) => [`${w.who}|${w.feature}`, `${w.waitingOn?.source}:${w.waitingOn?.sessionID}`]))
  const mism = Object.entries(expectWaits).filter(([k, v]) => (gotWaits[k] ?? "") !== v)
  check("lock.waiting names correct holder (4 waiters)", mism.length === 0 && waitingEvents.length === 4, mism.length ? `mismatch ${JSON.stringify(mism)} got ${JSON.stringify(gotWaits)}` : `${waitingEvents.length} events`)
  const badHolder = waitingEvents.filter((w) => w.expected && `${w.waitingOn?.source}:${w.waitingOn?.sessionID}` !== `${w.expected.source}:${w.expected.sessionID}`)
  check("waitingOn == holder seen in event stream", badHolder.length === 0, JSON.stringify(badHolder))
  check("claude edits auth without waiting", !waitingEvents.some((w) => w.who.includes("demo-claude") && w.feature === "auth") && stats.claudeAuthMs < 1500, `${stats.claudeAuthMs}ms`)
  const routerWait = stats.clineWaitMs[ROUTER] ?? 0
  check("cline hook WAITED on shared (no cancel, no override), granted when Claude released", stats.denies.cline === 0 && stats.clineWarned === 0 && routerWait >= 1000, `cline wait=${routerWait}ms cancels=${stats.denies.cline} warned=${stats.clineWarned} claude denies=${stats.denies.claude}`)
  check("final GET /locks empty", final.locks.length === 0 && final.waiters.length === 0, JSON.stringify(final))

  check("solo: Cline alone never denied", solo.denied === 0, `denied=${solo.denied}`)
  check("solo: zero lock.* events, no waiters", solo.lockEvents.length === 0 && solo.waiters === 0, `${solo.lockEvents.map((e) => e.type).join(",") || "none"}; waiters=${solo.waiters}`)
  check("orphan: new owner proceeds after liveSeconds via stale takeover", orphan.done && orphan.stale === 1 && orphan.override === 0 && !orphan.firstDenied, JSON.stringify(orphan))
  check("supersede: new Cline task proceeds at once (0 denials, 1 superseded expiry, no waiting)", !sup.denied && sup.sup === 1 && sup.waiting === 0, JSON.stringify(sup))
  check("orphan: not granted before the owner went stale", orphan.ms >= 1500, `${orphan.ms}ms`)

  console.log("\nRESULT")
  for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  [${r.detail}]` : ""}`)
  const failed = results.filter((r) => !r.ok).length
  console.log(failed ? `\nFAIL (${failed} assertion(s))` : "\nPASS")
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
