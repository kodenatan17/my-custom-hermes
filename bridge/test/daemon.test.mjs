import { test, before, after, describe } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { request } from "node:http"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const PORT = 4792
const DAEMON = join(dirname(fileURLToPath(import.meta.url)), "..", "daemon.mjs")
let child

function http(method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
    const h = { host: `127.0.0.1:${PORT}`, ...headers }
    if (data !== undefined && !("content-type" in h)) h["content-type"] = "application/json"
    const req = request({ host: "127.0.0.1", port: PORT, method, path, headers: h }, (res) => {
      let t = ""
      res.on("data", (c) => (t += c))
      res.on("end", () => { let j = null; try { j = JSON.parse(t) } catch {} ; resolve({ status: res.statusCode, json: j, text: t }) })
    })
    req.on("error", reject)
    req.end(data)
  })
}
const post = (path, body, headers) => http("POST", path, { body, headers })
const claim = (o) => post("/claim", { agent: "coder", ...o })

before(async () => {
  child = spawn(process.execPath, [DAEMON], { env: { ...process.env, OFFICE_BRIDGE_PORT: String(PORT) }, stdio: "ignore" })
  for (let i = 0; i < 50; i++) {
    try { if ((await http("GET", "/health")).json?.ok) return } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error("daemon did not start")
})
after(() => { child?.kill("SIGKILL") })

const P = (f) => `seedly_app/lib/features/${f}/a.dart`

describe("claim/release over HTTP", () => {
  test("1 contention: 200 granted, then 409 held with holder; /locks and /health count", async () => {
    const a = await claim({ owner: "A", source: "claude", sessionID: "sa", path: P("auth") })
    assert.equal(a.status, 200); assert.equal(a.json.granted, true); assert.equal(a.json.feature, "auth")
    const b = await claim({ owner: "B", source: "cline", sessionID: "sb", path: P("auth") })
    assert.equal(b.status, 409)
    assert.equal(b.json.granted, false); assert.equal(b.json.reason, "held")
    assert.equal(b.json.holder.source, "claude"); assert.equal(b.json.queuePosition, 1)
    assert.ok(b.json.retryAfterMs > 0)
    const l = (await http("GET", "/locks")).json
    assert.equal(l.locks.length, 1); assert.equal(l.waiters.length, 1)
    assert.equal((await http("GET", "/health")).json.locks, 1)
  })
  test("2/4 other feature and non-feature paths granted", async () => {
    assert.equal((await claim({ owner: "B", source: "cline", path: P("home") })).status, 200)
    const r = await claim({ owner: "B", source: "cline", path: "README.md" })
    assert.equal(r.status, 200); assert.equal(r.json.feature, null)
  })
  test("3 shared path conflict", async () => {
    assert.equal((await claim({ owner: "A", source: "claude", path: "seedly_app/pubspec.yaml" })).status, 200)
    assert.equal((await claim({ owner: "B", source: "cline", path: "seedly_app/lib/cores/router/r.dart" })).status, 409)
  })
  test("8 release frees, other owner no-op, idempotent", async () => {
    assert.deepEqual((await post("/release", { owner: "nobody" })).json.released, [])
    const r = await post("/release", { owner: "A" })
    assert.equal(r.status, 200); assert.deepEqual(r.json.released.sort(), ["_shared", "auth"])
    assert.deepEqual((await post("/release", { owner: "A" })).json.released, [])
    const g = await claim({ owner: "B", source: "cline", path: P("auth") })
    assert.equal(g.status, 200) // B was queue head
    await post("/release", { owner: "B" })
  })
  test("17 long owner/sessionID clipped to 200, long path sliced (no crash)", async () => {
    const long = "o".repeat(500)
    const r = await claim({ owner: long, source: "s".repeat(500), sessionID: "i".repeat(500), path: P("clip") })
    assert.equal(r.status, 200)
    const l = (await http("GET", "/locks")).json.locks.find((x) => x.feature === "clip")
    assert.equal(l.owner.length, 200); assert.equal(l.source.length, 200); assert.equal(l.sessionID.length, 200)
    assert.equal((await post("/release", { owner: long })).json.released[0], "clip") // clipped owner matches on release
    assert.equal((await claim({ owner: "x", source: "s", path: P("clip") + "/" + "p".repeat(3000) })).status, 200)
    await post("/release", { owner: "x" })
  })
})

describe("14 guards", () => {
  for (const path of ["/claim", "/release"]) {
    const ok = path === "/claim" ? { owner: "G", source: "s", path: P("g") } : { owner: "G" }
    test(`${path}: bad Host 403`, async () => assert.equal((await post(path, ok, { host: "evil.com:4792" })).status, 403))
    test(`${path}: bad Origin 403`, async () => assert.equal((await post(path, ok, { origin: "http://evil.com" })).status, 403))
    test(`${path}: allowed Origin accepted`, async () => assert.equal((await post(path, ok, { origin: "http://localhost:5173" })).status, 200))
    test(`${path}: wrong content-type 415`, async () => assert.equal((await post(path, JSON.stringify(ok), { "content-type": "text/plain" })).status, 415))
    test(`${path}: invalid JSON 400`, async () => assert.equal((await post(path, "{nope")).status, 400))
    test(`${path}: >64KB 413`, async () => {
      const r = await post(path, JSON.stringify({ ...ok, junk: "x".repeat(70_000) })).catch((e) => ({ status: e.code }))
      assert.equal(r.status, 413)
    })
  }
  test("/claim missing required field 400 (owner, source, path each)", async () => {
    for (const miss of ["owner", "source", "path"]) {
      const b = { owner: "G", source: "s", path: P("g") }; delete b[miss]
      assert.equal((await post("/claim", b)).status, 400, miss)
    }
    assert.equal((await post("/claim", { owner: 5, source: "s", path: P("g") })).status, 400)
    assert.equal((await post("/claim", "null")).status, 400)
  })
  test("/release missing owner 400", async () => assert.equal((await post("/release", {})).status, 400))
  test("existing /event still works", async () => {
    const r = await post("/event", { type: "activity", agent: "coder", text: "hi" })
    assert.equal(r.status, 200); assert.equal(r.json.ok, true)
  })
})

describe("18 presence via /event", () => {
  const owners = async () => (await http("GET", "/locks")).json.owners
  test("e POST /event marks its sessionID owner live; explicit owner field wins", async () => {
    await post("/event", { type: "activity", agent: "orchestrator", sessionID: "cline:EV1", source: "cline", text: "x" })
    await post("/event", { type: "activity", agent: "coder", sessionID: "child-sess", owner: "opencode:ROOT1", source: "opencode" })
    const o = await owners()
    assert.equal(o.find((x) => x.owner === "cline:EV1")?.live, true)
    assert.equal(o.find((x) => x.owner === "opencode:ROOT1")?.live, true)
    assert.equal(o.find((x) => x.owner === "child-sess"), undefined)
  })
  test("claim (even denied) counts as presence; liveness makes a lock block another owner", async () => {
    await claim({ owner: "PA", source: "claude", path: P("pres") })
    const b = await claim({ owner: "PB", source: "cline", path: P("pres") })
    assert.equal(b.status, 409)
    const o = await owners()
    assert.equal(o.find((x) => x.owner === "PB")?.live, true)
    await post("/release", { owner: "PA" }); await post("/release", { owner: "PB" })
  })
})

test("POST /supersede validates input and guards host", async () => {
  assert.equal((await post("/supersede", { source: "cline" })).status, 400)
  const ok = await post("/supersede", { source: "cline", owner: "cline:new" })
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.json.superseded, [])
  assert.equal((await post("/supersede", { source: "cline", owner: "x" }, { host: "evil.example:4792" })).status, 403)
})

describe("Agent Interaction Viewer: event envelope", () => {
  /** Minimal ws subscriber (Node 22 global WebSocket); collects the hello + live events. */
  async function wsCapture() {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
    const events = []
    let hello = null
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.type === "hello") hello = d; else events.push(d) }
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
    for (let i = 0; i < 20 && !hello; i++) await new Promise((r) => setTimeout(r, 25))
    return { events, hello: () => hello, close: () => ws.close() }
  }
  const settle = () => new Promise((r) => setTimeout(r, 150))
  const seqOf = (id) => Number(id.split("-").pop())

  test("eventId unique and increasing; spoofed ts/eventId are overridden", async () => {
    const ws = await wsCapture()
    const before = Date.now()
    try {
      await post("/event", [
        { type: "activity", agent: "coder", sessionID: "v1", text: "a", ts: 1, eventId: "evil-1" },
        { type: "activity", agent: "coder", sessionID: "v1", text: "b", ts: 9e15, eventId: "evil-1" },
        { type: "activity", agent: "coder", sessionID: "v1", text: "c" },
      ])
      await settle()
    } finally { ws.close() }
    const got = ws.events.filter((e) => e.sessionID === "v1")
    assert.equal(got.length, 3)
    assert.equal(new Set(got.map((e) => e.eventId)).size, 3)
    for (const e of got) {
      assert.notEqual(e.eventId, "evil-1")
      assert.match(e.eventId, /^[0-9a-z]+-\d+$/)
      assert.ok(e.ts >= before && e.ts <= Date.now(), `ts ${e.ts}`)
    }
    assert.ok(seqOf(got[0].eventId) < seqOf(got[1].eventId) && seqOf(got[1].eventId) < seqOf(got[2].eventId))
  })

  test("new fields: prompt/result clipped to 4000, error 1000, ids 200; durationMs only when finite 0..24h", async () => {
    const ws = await wsCapture()
    try {
      await post("/event", [
        { type: "handback", agent: "coder", sessionID: "v2", prompt: "p".repeat(5000), result: "r".repeat(5000), error: "e".repeat(1500), correlationId: "c".repeat(300), toolName: "t".repeat(300), requestedAgent: "q".repeat(300), childSessionID: "s".repeat(300), status: "o".repeat(300), durationMs: 1500 },
        { type: "handback", agent: "coder", sessionID: "v2", durationMs: -1, prompt: 42 },
        { type: "handback", agent: "coder", sessionID: "v2", durationMs: 86_400_001 },
        { type: "handback", agent: "coder", sessionID: "v2", durationMs: "5" },
      ])
      await settle()
    } finally { ws.close() }
    const [a, b, c, d] = ws.events.filter((e) => e.sessionID === "v2")
    assert.equal(a.prompt.length, 4000); assert.equal(a.result.length, 4000); assert.equal(a.error.length, 1000)
    for (const k of ["correlationId", "toolName", "requestedAgent", "childSessionID", "status"]) assert.equal(a[k].length, 200, k)
    assert.equal(a.durationMs, 1500)
    assert.equal(b.durationMs, undefined); assert.equal(b.prompt, undefined)
    assert.equal(c.durationMs, undefined); assert.equal(d.durationMs, undefined)
  })

  test("secrets are masked in text/prompt/result/error", async () => {
    const ws = await wsCapture()
    try {
      await post("/event", { type: "dispatch", agent: "orchestrator", target: "coder", sessionID: "v3", text: "password=hunter2", prompt: "key sk-abcdefghijklmnopqrstuv", result: "Bearer abcdefghijkl", error: "ghp_abcdefghijklmnopqrstuvwxyz" })
      await settle()
    } finally { ws.close() }
    const e = ws.events.find((x) => x.sessionID === "v3")
    assert.doesNotMatch(JSON.stringify(e), /hunter2|sk-abcdef|abcdefghijkl|ghp_abc/)
  })

  test("unknown/extra fields are masked too (routing ids exempt)", async () => {
    const ws = await wsCapture()
    try {
      await post("/event", { type: "activity", agent: "coder", sessionID: "v5", extra: "password=hunter2", nested: { apiKey: "k-raw", list: ["Bearer abcdefghijkl"] }, cookie: "c-raw" })
      await settle()
    } finally { ws.close() }
    const e = ws.events.find((x) => x.sessionID === "v5")
    assert.equal(e.extra, "password=***")
    assert.deepEqual(e.nested, { apiKey: "***", list: ["Bearer ***"] })
    assert.equal(e.cookie, "***")
    assert.equal(e.sessionID, "v5")
  })

  test("replay is bounded by a 600KB byte budget (oldest evicted first) and reports dropped history", async () => {
    const big = { type: "handback", agent: "coder", sessionID: "v4", prompt: "p".repeat(4000), result: "r".repeat(4000) }
    for (let i = 0; i < 20; i++) await post("/event", Array.from({ length: 6 }, () => big))
    const h = (await http("GET", "/health")).json
    assert.ok(h.replayBytes <= 600_000, `replayBytes ${h.replayBytes}`)
    assert.ok(h.replay < 120, `replay ${h.replay}`)
    const ws = await wsCapture()
    ws.close()
    const replay = ws.hello().replay
    assert.equal(replay.length, h.replay)
    assert.ok(Buffer.byteLength(JSON.stringify(replay)) <= 600_000 + replay.length)
    assert.ok(seqOf(replay[0].eventId) > 0, "first replayed seq > 0 => older history dropped")
  })
})
