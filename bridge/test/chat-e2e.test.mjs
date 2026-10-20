// End-to-end smoke for the Agent Interaction Viewer (no browser): private daemon <- hook.mjs (Claude PreToolUse +
// PostToolUse Task) -> ws client (live + hello replay) -> visualizer chat store. Same spawn/ws helpers as hook.test.mjs.
import { test, before, after, describe } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { mkdtempSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { agentSummaries, buildIndex, deliveryStatus, durationOf, initialInteractionState, interactionReducer } from "../../visualizer/src/chat/model.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const HOOK = join(HERE, "..", "hook.mjs")
const DAEMON = join(HERE, "..", "daemon.mjs")
const PORT = 4798
const LOG = join(mkdtempSync(join(tmpdir(), "chat-e2e-")), "hook.log")
let child

const SK = "sk-abcdefghijklmnopqrstuv"
const URL_CRED = "https://u:pass@host"
const SECRETS = /sk-abcdefghijklmnopqrstuv|u:pass@|:pass@|hunter2/

function hook(payload) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [HOOK, "claude"], {
      env: { ...process.env, OFFICE_BRIDGE_PORT: String(PORT), OFFICE_NODE: "/usr/bin/true", OFFICE_HOOK_LOG: LOG },
      stdio: ["pipe", "pipe", "pipe"],
    })
    let out = ""
    p.stdout.on("data", (c) => (out += c))
    p.on("close", (code) => resolve({ code, out }))
    p.stdin.end(JSON.stringify(payload))
  })
}

/** ws subscriber (Node 22 global WebSocket): hello + live events. */
async function wsClient() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
  const events = []
  let hello = null
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.type === "hello") hello = d
    else events.push(d)
  }
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  for (let i = 0; i < 40 && !hello; i++) await new Promise((r) => setTimeout(r, 25))
  return { events, hello: () => hello, close: () => ws.close() }
}
const settle = () => new Promise((r) => setTimeout(r, 200))
const health = () => fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.json())

const base = {
  session_id: "E2E",
  tool_name: "Task",
  tool_use_id: "toolu_E2E01",
  tool_input: { subagent_type: "coder", description: "Clone and build", prompt: `Clone ${URL_CRED}/repo.git, then call the API with ${SK}.` },
}

let R = {}
before(async () => {
  child = spawn(process.execPath, [DAEMON], { env: { ...process.env, OFFICE_BRIDGE_PORT: String(PORT) }, stdio: "ignore" })
  for (let i = 0; i < 50; i++) {
    try { if ((await health()).ok) break } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  const ws = await wsClient()
  const pre = await hook({ ...base, hook_event_name: "PreToolUse" })
  const post = await hook({
    ...base,
    hook_event_name: "PostToolUse",
    tool_response: { content: [{ type: "text", text: `Built. Remote ${URL_CRED}/repo.git, password=hunter2, key ${SK}` }], totalDurationMs: 2468 },
  })
  await settle()
  ws.close()
  const late = await wsClient() // a fresh client = what the visualizer gets on (re)connect
  late.close()
  R = { pre, post, live: ws.events.filter((e) => e.sessionID === "claude:E2E"), replay: late.hello().replay }
})
after(() => child?.kill("SIGKILL"))

describe("Agent Interaction Viewer e2e: hook -> daemon -> ws -> chat store", () => {
  test("both hooks exit 0 and print nothing (no deny for a Task)", () => {
    assert.equal(R.pre.code, 0); assert.equal(R.pre.out.trim(), "")
    assert.equal(R.post.code, 0); assert.equal(R.post.out.trim(), "")
  })
  test("live: exactly one dispatch then one handback sharing correlationId claude:toolu_E2E01", () => {
    assert.deepEqual(R.live.map((e) => e.type), ["dispatch", "handback"])
    const [d, h] = R.live
    assert.equal(d.correlationId, "claude:toolu_E2E01")
    assert.equal(h.correlationId, d.correlationId)
    assert.equal(d.agent, "orchestrator"); assert.equal(d.target, "coder")
    assert.equal(h.agent, "coder"); assert.equal(h.target, "orchestrator")
    assert.equal(h.status, "ok"); assert.equal(h.durationMs, 2468)
  })
  test("secrets are masked in every field (sk- token, URL credentials, password=)", () => {
    const json = JSON.stringify(R.live)
    assert.doesNotMatch(json, SECRETS)
    const [d, h] = R.live
    assert.match(d.prompt, /^Clone https:\/\/\*\*\*:\*\*\*@host\/repo\.git, then call the API with \*\*\*\.$/)
    assert.match(h.result, /^Built\. Remote https:\/\/\*\*\*:\*\*\*@host/)
  })
  test("eventIds are daemon-assigned, unique and increasing; ts daemon-assigned", () => {
    const ids = R.live.map((e) => e.eventId)
    assert.equal(new Set(ids).size, ids.length)
    for (const id of ids) assert.match(id, /^[0-9a-z]+-\d+$/)
    const seq = ids.map((id) => Number(id.split("-").pop()))
    assert.ok(seq[0] < seq[1])
    for (const e of R.live) assert.ok(typeof e.ts === "number" && Math.abs(Date.now() - e.ts) < 60_000)
  })
  test("hello replay on a new connection contains both events, byte-identical to the live copies", () => {
    const mine = R.replay.filter((e) => e.sessionID === "claude:E2E")
    assert.deepEqual(mine, R.live)
    assert.doesNotMatch(JSON.stringify(R.replay), SECRETS)
    assert.equal(new Set(R.replay.map((e) => e.eventId)).size, R.replay.length)
  })
  test("chat store: live + replay merge to 2 entries, delivery ok, duration from the producer, coder done", () => {
    let s = R.live.reduce((st, event) => interactionReducer(st, { type: "event", event }), initialInteractionState)
    s = interactionReducer(s, { type: "hello", replay: R.replay })
    const mine = s.entries.filter((e) => e.ev.sessionID === "claude:E2E")
    assert.equal(mine.length, 2)
    const idx = buildIndex(s.entries)
    const d = mine.find((e) => e.ev.type === "dispatch")
    assert.equal(deliveryStatus(d, idx), "ok")
    assert.equal(durationOf(d, idx), 2468)
    assert.equal(agentSummaries(s.entries).get("coder").status, "done")
  })
  test("hook.log records the hooks but never the prompt/response secrets", () => {
    assert.ok(existsSync(LOG))
    const log = readFileSync(LOG, "utf8")
    assert.match(log, /"hookName":"PreToolUse"/)
    assert.match(log, /"hookName":"PostToolUse"/)
    assert.doesNotMatch(log, SECRETS)
  })
})

describe("daemon masks the known envelope fields too", () => {
  test("agent/target/feature/phase/priority/waitingOn are masked before clip, like text", async () => {
    const ws = await wsClient()
    try {
      await fetch(`http://127.0.0.1:${PORT}/event`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "lock.waiting", sessionID: "envmask", text: "password=hunter2",
          agent: `coder ${SK}`, target: URL_CRED, feature: "password=hunter2", phase: `key ${SK}`, priority: "token=abc123zz",
          waitingOn: { source: "claude", feature: "Bearer abcdefghijkl" },
        }),
      })
      await settle()
    } finally { ws.close() }
    const e = ws.events.find((x) => x.sessionID === "envmask")
    assert.ok(e, "event delivered")
    assert.equal(e.text, "password=***")
    assert.doesNotMatch(JSON.stringify(e), /sk-abcdefghijklmnopqrstuv|u:pass@|hunter2|abc123zz|abcdefghijkl/)
  })
})

describe("daemon replay count cap", () => {
  test("replay holds at most 500 events (oldest evicted) and flags dropped history", async () => {
    for (let i = 0; i < 6; i++) {
      const batch = Array.from({ length: 100 }, (_, k) => ({ type: "activity", agent: "coder", sessionID: "cap", text: `n${i * 100 + k}` }))
      const r = await fetch(`http://127.0.0.1:${PORT}/event`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(batch) })
      assert.equal(r.status, 200)
    }
    const h = await health()
    assert.equal(h.replay, 500)
    const ws = await wsClient()
    ws.close()
    const replay = ws.hello().replay
    assert.equal(replay.length, 500)
    assert.equal(replay.at(-1).text, "n599")
    assert.equal(replay[0].text, "n100")
    assert.ok(Number(replay[0].eventId.split("-").pop()) > 0)
    const s = interactionReducer(initialInteractionState, { type: "hello", replay })
    assert.equal(s.historyDropped, true)
    assert.equal(s.entries.length, 500)
  })
})
