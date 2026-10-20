import { test, before, after, describe } from "node:test"
import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"

const HERE = dirname(fileURLToPath(import.meta.url))
const HOOK = join(HERE, "..", "hook.mjs")
const DAEMON = join(HERE, "..", "daemon.mjs")
const ROOT = join(HERE, "..", "..", "..")
const PORT = 4793, DEAD = 4794
let child
const LOG = join(mkdtempSync(join(tmpdir(), "hooklog-")), "hook.log")

const abs = (feature, f = "a.dart") => join(ROOT, "seedly_app/lib/features", feature, f)
const api = (path, body) => fetch(`http://127.0.0.1:${PORT}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json())
/** Minimal ws subscriber (Node 22 global WebSocket); collects live events. */
async function wsCapture(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  const events = []
  ws.onmessage = (m) => { try { events.push(JSON.parse(m.data)) } catch {} }
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  return { events, close: () => ws.close() }
}
const lines = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [])
const locks = () => fetch(`http://127.0.0.1:${PORT}/locks`).then((r) => r.json())

/** Runs hook.mjs with stdin JSON. OFFICE_NODE=true stops emit() from auto-spawning stray daemons. */
function hook(source, payload, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [HOOK, source], { env: { ...process.env, OFFICE_BRIDGE_PORT: String(PORT), OFFICE_NODE: "/usr/bin/true", OFFICE_HOOK_LOG: LOG, ...env }, stdio: ["pipe", "pipe", "pipe"] })
    let out = "", err = ""
    p.stdout.on("data", (c) => (out += c)); p.stderr.on("data", (c) => (err += c))
    p.on("close", (code) => resolve({ code, out, err, json: (() => { try { return JSON.parse(out) } catch { return null } })() }))
    p.stdin.end(typeof payload === "string" ? payload : JSON.stringify(payload))
  })
}
const claudePre = (tool, input, sid = "S1", extra = {}) => ({ hook_event_name: "PreToolUse", session_id: sid, tool_name: tool, tool_input: input, ...extra })
const clinePre = (tool, params, taskId = "T1") => ({ hookName: "PreToolUse", taskId, preToolUse: { toolName: tool, parameters: params } })

let R = {}
before(async () => {
  child = spawn(process.execPath, [DAEMON], { env: { ...process.env, OFFICE_BRIDGE_PORT: String(PORT) }, stdio: "ignore" })
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 100)) }
  // Holders are other tools; deny paths wait the full budget (8s), so run them concurrently once.
  for (const [o, s, f] of [["h1", "cline", "auth"], ["h2", "opencode", "home"], ["h3", "claude", "pay"], ["claude:h4", "claude", "cart"]]) await api("/claim", { owner: o, source: s, sessionID: `sess-${o.replace("claude:", "")}`, path: `seedly_app/lib/features/${f}/z.dart` })
  const [claudeDeny, clineDeny, reads, multi, grantedFree, sameOwner] = await Promise.all([
    hook("claude", claudePre("Edit", { file_path: abs("auth") })),
    hook("cline", clinePre("edit", { path: abs("home") }), { OFFICE_MAX_WAIT_SECONDS: "1" }),
    Promise.all([hook("claude", claudePre("Read", { file_path: abs("auth") })), hook("claude", claudePre("Grep", { pattern: "x", path: abs("auth") })), hook("cline", clinePre("read_file", { path: abs("home") }))]),
    hook("claude", claudePre("MultiEdit", { file_path: abs("free1"), files: [abs("pay")] }, "S2")),
    hook("claude", claudePre("Write", { file_path: abs("free2") }, "S3")),
    hook("claude", claudePre("Edit", { file_path: abs("cart") }, "h4")),
  ])
  R = { claudeDeny, clineDeny, reads, multi, grantedFree, sameOwner }
})
after(() => { child?.kill("SIGKILL") })

describe("15 deny payloads", () => {
  test("Claude PreToolUse Edit on held feature => valid deny JSON naming feature + holder", () => {
    const r = R.claudeDeny
    assert.equal(r.code, 0)
    const o = r.json.hookSpecificOutput
    assert.equal(o.hookEventName, "PreToolUse"); assert.equal(o.permissionDecision, "deny")
    assert.match(o.permissionDecisionReason, /auth/); assert.match(o.permissionDecisionReason, /cline/); assert.match(o.permissionDecisionReason, /sess-h1/)
  })
  test("Cline conflict after the wait budget => {cancel:false,context} warning (never cancel:true), exit 0", () => {
    const r = R.clineDeny
    assert.equal(r.code, 0)
    assert.equal(r.json.cancel, false)
    assert.equal(r.json.errorMessage, undefined)
    assert.match(r.json.context, /home/); assert.match(r.json.context, /opencode/); assert.match(r.json.context, /sess-h2/)
    assert.ok(!r.out.includes('"cancel":true'))
  })
  test("Cline wait-expired publishes lock.override (reason wait-expired) and logs decision override", async () => {
    const l = lines()
    assert.ok(l.some((x) => x.kind === "claim" && x.source === "cline" && x.decision === "override" && /home/.test(x.path)), "log override")
    assert.ok(!l.some((x) => x.source === "cline" && x.decision === "denied"), "no cline denied")
    const ws = await wsCapture(PORT)
    try {
      await hook("cline", clinePre("edit", { path: abs("home") }, "T-ov"), { OFFICE_MAX_WAIT_SECONDS: "1" })
      await new Promise((r) => setTimeout(r, 200))
    } finally { ws.close() }
    const e = ws.events.find((x) => x.type === "lock.override" && x.source === "cline" && x.sessionID === "cline:T-ov")
    assert.ok(e, "lock.override event")
    assert.equal(e.reason, "wait-expired"); assert.equal(e.feature, "home"); assert.equal(e.waitingOn.source, "opencode")
  })
  test("Cline granted mid-wait when the holder releases => {cancel:false} without context, well before the budget", async () => {
    await api("/claim", { owner: "rw1", source: "opencode", sessionID: "rw1", path: "seedly_app/lib/features/relwait/z.dart" })
    setTimeout(() => api("/release", { owner: "rw1" }), 1200)
    const t0 = Date.now()
    const r = await hook("cline", clinePre("edit", { path: abs("relwait") }, "RW"), { OFFICE_MAX_WAIT_SECONDS: "10" })
    const took = Date.now() - t0
    assert.deepEqual(r.json, { cancel: false })
    assert.ok(took >= 1000 && took < 4000, `took ${took}ms`)
  })
  test("solo Cline (no other live owner) never waits", async () => {
    const t0 = Date.now()
    const dead = await hook("cline", clinePre("edit", { path: abs("soloc") }, "SOLO"), { OFFICE_MAX_WAIT_SECONDS: "10", OFFICE_BRIDGE_PORT: String(DEAD) })
    assert.deepEqual(dead.json, { cancel: false })
    assert.ok(Date.now() - t0 < 2000)
  })
  test("non-write tools are never gated (Claude Read/Grep print nothing; Cline read => cancel:false)", () => {
    const [a, b, c] = R.reads
    assert.equal(a.code, 0); assert.equal(a.out.trim(), "")
    assert.equal(b.out.trim(), "")
    assert.deepEqual(c.json, { cancel: false })
  })
  test("free feature write is allowed (no deny output)", () => {
    assert.equal(R.grantedFree.code, 0); assert.equal(R.grantedFree.out.trim(), "")
  })
  test("17 MultiEdit spanning free + held feature: denied on the held one (names 'pay')", () => {
    assert.equal(R.multi.json.hookSpecificOutput.permissionDecision, "deny")
    assert.match(R.multi.json.hookSpecificOutput.permissionDecisionReason, /pay/)
  })
  test("17 MultiEdit partial claim: the free feature stays locked by the denied caller (documenting)", async () => {
    const l = (await locks()).locks
    assert.ok(l.find((x) => x.feature === "free1" && x.owner === "claude:S2"))
  })
  test("16 same owner across agents reentrant: session owner of holder is not denied", () => {
    assert.equal(R.sameOwner.out.trim(), "")
  })
})

describe("16 release semantics", () => {
  test("SubagentStop does NOT release; Stop and SessionEnd do", async () => {
    await api("/claim", { owner: "claude:R1", source: "claude", path: "seedly_app/lib/features/rel/a.dart" })
    await hook("claude", { hook_event_name: "SubagentStop", session_id: "R1", agent_type: "coder" })
    assert.ok((await locks()).locks.find((l) => l.feature === "rel"))
    await hook("claude", { hook_event_name: "Stop", session_id: "R1" })
    assert.equal((await locks()).locks.find((l) => l.feature === "rel"), undefined)
    await api("/claim", { owner: "claude:R2", source: "claude", path: "seedly_app/lib/features/rel2/a.dart" })
    await hook("claude", { hook_event_name: "SessionEnd", session_id: "R2" })
    assert.equal((await locks()).locks.find((l) => l.feature === "rel2"), undefined)
  })
  test("Cline TaskComplete/TaskCancel/TaskError release; TaskStart does not", async () => {
    for (const name of ["TaskComplete", "TaskCancel", "TaskError"]) {
      await api("/claim", { owner: "cline:C1", source: "cline", path: "seedly_app/lib/features/cl/a.dart" })
      await hook("cline", { hookName: "TaskStart", taskId: "C1" })
      assert.ok((await locks()).locks.find((l) => l.feature === "cl"), "TaskStart must not release")
      await hook("cline", { hookName: name, taskId: "C1", error: { message: "x" } })
      assert.equal((await locks()).locks.find((l) => l.feature === "cl"), undefined, name)
    }
  })
})

describe("13 fail-open", () => {
  const writeHeld = claudePre("Edit", { file_path: abs("auth") }, "FO")
  test("daemon down (ECONNREFUSED): exit 0, no deny", async () => {
    const r = await hook("claude", writeHeld, { OFFICE_BRIDGE_PORT: String(DEAD) })
    assert.equal(r.code, 0); assert.equal(r.out.trim(), "")
    const c = await hook("cline", clinePre("edit", { path: abs("auth") }), { OFFICE_BRIDGE_PORT: String(DEAD) })
    assert.equal(c.code, 0); assert.deepEqual(c.json, { cancel: false })
  })
  test("OFFICE_BRIDGE=off: allowed even though held", async () => {
    const r = await hook("claude", writeHeld, { OFFICE_BRIDGE: "off" })
    assert.equal(r.code, 0); assert.equal(r.out.trim(), "")
  })
  test("garbage 200 'office-bridge ok' body (legacy bridge) => allowed", async () => {
    const { createServer } = await import("node:http")
    const srv = createServer((q, s) => { s.writeHead(200); s.end("office-bridge ok") })
    await new Promise((r) => srv.listen(4795, "127.0.0.1", r))
    try {
      const r = await hook("claude", writeHeld, { OFFICE_BRIDGE_PORT: "4795" })
      assert.equal(r.code, 0); assert.equal(r.out.trim(), "")
    } finally { srv.close() }
  })
  test("garbage stdin / empty stdin / unknown source: exit 0, no crash", async () => {
    for (const [src, input] of [["claude", "not json"], ["claude", ""], ["cline", "{{"], ["bogus", "{}"]]) {
      const r = await hook(src, input)
      assert.equal(r.code, 0, `${src}:${input}`)
    }
  })
  test("path outside repo root is not gated", async () => {
    const r = await hook("claude", claudePre("Edit", { file_path: "/etc/hosts" }))
    assert.equal(r.out.trim(), "")
  })
})

describe("18 hook.log, wait budget, solo", () => {
  test("log has claim decisions (denied/granted/failopen) and per-hook durMs", async () => {
    await hook("claude", claudePre("Write", { file_path: abs("logfree") }, "LG1"))
    await hook("claude", claudePre("Edit", { file_path: abs("auth") }, "FO2"), { OFFICE_BRIDGE_PORT: String(DEAD) })
    const l = lines()
    assert.ok(l.some((x) => x.kind === "claim" && x.decision === "denied" && /auth/.test(x.path) && x.source === "claude"), "denied")
    assert.ok(l.some((x) => x.kind === "claim" && x.decision === "granted" && /logfree/.test(x.path)), "granted")
    assert.ok(l.some((x) => x.kind === "claim" && x.decision === "failopen"), "failopen")
    assert.ok(l.some((x) => x.kind === "hook" && typeof x.durMs === "number" && x.hookName === "PreToolUse"), "durMs")
  })
  test("g multi-path claim shares ONE wait budget (cline 3s): path1 freed mid-wait, path2 held => warning for path2, total < 3.5s", async () => {
    await api("/claim", { owner: "mp1", source: "claude", sessionID: "mp1", path: "seedly_app/lib/features/mpa/z.dart" })
    await api("/claim", { owner: "mp2", source: "claude", sessionID: "mp2", path: "seedly_app/lib/features/mpb/z.dart" })
    setTimeout(() => api("/release", { owner: "mp1" }), 1500)
    const t0 = Date.now()
    const r = await hook("cline", clinePre("editor", { path: abs("mpa"), files: [abs("mpb")] }, "MP"), { OFFICE_MAX_WAIT_SECONDS: "3" })
    const took = Date.now() - t0
    assert.equal(r.json.cancel, false)
    assert.match(r.json.context, /mpb/); assert.doesNotMatch(r.json.context, /mpa/)
    assert.ok(took < 3500, `took ${took}ms`)
  })
  test("log rotates past 512KB", async () => {
    writeFileSync(LOG, "x".repeat(600 * 1024))
    await hook("claude", claudePre("Read", { file_path: abs("auth") }))
    assert.ok(existsSync(`${LOG}.1`))
    assert.ok(readFileSync(LOG, "utf8").length < 10_000)
  })
})

describe("Agent Interaction Viewer: Claude dispatch/handback", () => {
  const SECRET = "sk-abcdefghijklmnopqrstuv"
  const task = (extra) => ({ session_id: "AIV", tool_name: "Task", tool_use_id: "toolu_01XYZ", tool_input: { subagent_type: "general-purpose", description: "Find auth", prompt: `Find the auth flow. key ${SECRET}` }, ...extra })
  async function capture(run) {
    const ws = await wsCapture(PORT)
    try { await run(); await new Promise((r) => setTimeout(r, 200)) } finally { ws.close() }
    return ws.events.filter((e) => e.sessionID === "claude:AIV")
  }

  test("PreToolUse Task => dispatch with correlationId, requestedAgent and a masked full prompt", async () => {
    const [d] = await capture(() => hook("claude", task({ hook_event_name: "PreToolUse" })))
    assert.equal(d.type, "dispatch"); assert.equal(d.agent, "orchestrator"); assert.equal(d.target, "scout")
    assert.equal(d.correlationId, "claude:toolu_01XYZ"); assert.equal(d.requestedAgent, "general-purpose")
    assert.match(d.prompt, /^Find the auth flow\. key \*\*\*$/)
    assert.equal(d.text, "Find auth")
  })
  test("roster subagent => no requestedAgent; no tool_use_id => no correlationId", async () => {
    const [d] = await capture(() => hook("claude", task({ hook_event_name: "PreToolUse", tool_use_id: undefined, tool_input: { subagent_type: "coder", description: "x" } })))
    assert.equal(d.target, "coder"); assert.equal(d.requestedAgent, undefined); assert.equal(d.correlationId, undefined)
  })
  test("PostToolUse Task => handback ok (subagent -> caller) with masked result and durationMs", async () => {
    const [h] = await capture(() => hook("claude", task({ hook_event_name: "PostToolUse", tool_response: { content: [{ type: "text", text: `Found it. password=hunter2 ${SECRET}` }], totalDurationMs: 4321 } })))
    assert.equal(h.type, "handback"); assert.equal(h.agent, "scout"); assert.equal(h.target, "orchestrator")
    assert.equal(h.status, "ok"); assert.equal(h.correlationId, "claude:toolu_01XYZ"); assert.equal(h.requestedAgent, "general-purpose")
    assert.equal(h.durationMs, 4321)
    assert.match(h.result, /^Found it\./); assert.doesNotMatch(h.result, /hunter2|sk-abc/)
  })
  test("background Task: PostToolUse at launch => handback status unknown, no result, no duration", async () => {
    const [h] = await capture(() => hook("claude", task({ hook_event_name: "PostToolUse", tool_input: { subagent_type: "coder", description: "Long job", run_in_background: true }, tool_response: { content: [{ type: "text", text: "Agent launched in background (id a1)" }], totalDurationMs: 12 } })))
    assert.equal(h.type, "handback"); assert.equal(h.status, "unknown")
    assert.equal(h.result, undefined); assert.equal(h.durationMs, undefined)
    assert.match(h.text, /launched in background/)
  })
  test("SubagentStop: without agent_type => orchestrator idle with reason subagent-stop; with agent_type => no reason", async () => {
    const got = await capture(async () => {
      await hook("claude", { hook_event_name: "SubagentStop", session_id: "AIV" })
      await hook("claude", { hook_event_name: "SubagentStop", session_id: "AIV", agent_type: "coder" })
    })
    assert.deepEqual(got.map((e) => [e.type, e.agent, e.reason]), [["idle", "orchestrator", "subagent-stop"], ["idle", "coder", undefined]])
  })
  test("PostToolUse with a string response and no duration", async () => {
    const [h] = await capture(() => hook("claude", task({ hook_event_name: "PostToolUse", tool_response: "plain report" })))
    assert.equal(h.result, "plain report"); assert.equal(h.durationMs, undefined)
  })
  test("PostToolUse for a non-Task tool emits nothing", async () => {
    const got = await capture(() => hook("claude", { hook_event_name: "PostToolUse", session_id: "AIV", tool_name: "Read", tool_use_id: "t", tool_response: "x" }))
    assert.equal(got.length, 0)
  })
  test("PostToolUseFailure Task => error (toolName + correlationId) and handback error", async () => {
    const got = await capture(() => hook("claude", task({ hook_event_name: "PostToolUseFailure", error: `boom token=${SECRET}` })))
    const err = got.find((e) => e.type === "error"), hb = got.find((e) => e.type === "handback")
    assert.equal(err.toolName, "Task"); assert.equal(err.correlationId, "claude:toolu_01XYZ")
    assert.equal(hb.status, "error"); assert.equal(hb.agent, "scout"); assert.match(hb.error, /^boom/); assert.doesNotMatch(hb.error, /sk-abc/)
  })
  test("PostToolUseFailure non-Task => only a tool error with toolName", async () => {
    const got = await capture(() => hook("claude", { hook_event_name: "PostToolUseFailure", session_id: "AIV", tool_name: "Bash", tool_use_id: "toolu_b" }))
    assert.deepEqual(got.map((e) => [e.type, e.toolName, e.correlationId]), [["error", "Bash", "claude:toolu_b"]])
  })
  test("dispatch text: a URL credential cut at the 60-char boundary does not leak", async () => {
    const description = "x".repeat(40) + " https://admin:SuperSecretPass@host.example/repo"
    const [d] = await capture(() => hook("claude", task({ hook_event_name: "PreToolUse", tool_input: { subagent_type: "coder", description } })))
    assert.ok(d.text.length <= 60)
    assert.doesNotMatch(d.text, /admin|Sup|Secret/)
  })
  test("Bash activity keeps the binary only; prompt is masked", async () => {
    const got = await capture(async () => {
      await hook("claude", claudePre("Bash", { command: `curl -H 'Authorization: Bearer abcdefghijkl' https://x.io/?token=zzz ${SECRET}` }, "AIV"))
      await hook("claude", { hook_event_name: "UserPromptSubmit", session_id: "AIV", prompt: `deploy with password=hunter2` })
    })
    const act = got.find((e) => e.type === "activity"), pr = got.find((e) => e.type === "prompt")
    assert.equal(act.text, "bash curl")
    assert.equal(pr.prompt, "deploy with password=***")
    assert.doesNotMatch(JSON.stringify(got), /hunter2|abcdefghijkl|zzz|sk-abc/)
  })
})
