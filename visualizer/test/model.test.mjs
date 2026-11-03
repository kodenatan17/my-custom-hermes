import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  agentSummaries,
  badgeOf,
  buildIndex,
  DEFAULT_KINDS,
  deliveryStatus,
  durationOf,
  filterEntries,
  initialInteractionState,
  interactionReducer,
  linkedEvents,
  MAX_ENTRIES,
  PINNED_AGENTS,
  replyCount,
  rowStatus,
  shortCorr,
  threadRootOf,
} from "../src/chat/model.mjs"

const NOW = 1_700_000_000_000
const ev = (o) => ({ source: "claude", sessionID: "claude:S", agent: "orchestrator", ...o })
const live = (state, event, now = NOW) => interactionReducer(state, { type: "event", event, now })
const hello = (state, replay, now = NOW) => interactionReducer(state, { type: "hello", replay, now })
const feed = (events, now = NOW) => events.reduce((s, e) => live(s, e, now), initialInteractionState)
const types = (s) => s.entries.map((e) => `${e.ev.type}:${e.ev.eventId ?? ""}`)

describe("dedupe + merge", () => {
  test("replay/live overlap: same eventId kept once; hello merges instead of resetting", () => {
    let s = feed([ev({ type: "prompt", ts: NOW - 30, eventId: "b-1", text: "hi" }), ev({ type: "busy", ts: NOW - 20, eventId: "b-2" })])
    s = hello(s, [ev({ type: "prompt", ts: NOW - 30, eventId: "b-1", text: "hi" }), ev({ type: "busy", ts: NOW - 20, eventId: "b-2" }), ev({ type: "idle", ts: NOW - 10, eventId: "b-3" })])
    assert.deepEqual(types(s), ["prompt:b-1", "busy:b-2", "idle:b-3"])
    s = live(s, ev({ type: "idle", ts: NOW - 10, eventId: "b-3" }))
    assert.equal(s.entries.length, 3)
  })
  test("no eventId: fingerprint fallback (ts|type|agent|sessionID|correlationId|text)", () => {
    const e = ev({ type: "activity", ts: NOW - 5, text: "read a.dart" })
    let s = feed([e, { ...e }])
    assert.equal(s.entries.length, 1)
    s = live(s, { ...e, text: "read b.dart" })
    assert.equal(s.entries.length, 2)
  })
  test("reducer never mutates the previous state (StrictMode double-invoke safe)", () => {
    const s1 = feed([ev({ type: "prompt", ts: NOW, eventId: "x-1" })])
    const a = live(s1, ev({ type: "busy", ts: NOW, eventId: "x-2" }))
    const b = live(s1, ev({ type: "busy", ts: NOW, eventId: "x-2" }))
    assert.equal(a.entries.length, 2); assert.equal(b.entries.length, 2); assert.equal(s1.entries.length, 1)
  })
  test("cap at MAX_ENTRIES keeps the newest", () => {
    const s = hello(initialInteractionState, Array.from({ length: MAX_ENTRIES + 10 }, (_, i) => ev({ type: "activity", ts: NOW - 100_000 + i, eventId: `c-${i}` })))
    assert.equal(s.entries.length, MAX_ENTRIES)
    assert.equal(s.entries[0].ev.eventId, "c-10")
    assert.equal(s.keys.size, MAX_ENTRIES)
  })
  test("historyDropped when the first replayed seq > 0", () => {
    assert.equal(hello(initialInteractionState, [ev({ type: "busy", ts: NOW, eventId: "k-0" })]).historyDropped, false)
    assert.equal(hello(initialInteractionState, [ev({ type: "busy", ts: NOW, eventId: "k-7" })]).historyDropped, true)
  })
  test("bad payloads count as parse errors and are dropped", () => {
    let s = live(initialInteractionState, null)
    s = live(s, { agent: "x" })
    s = interactionReducer(s, { type: "parseError" })
    assert.equal(s.parseErrors, 3); assert.equal(s.entries.length, 0)
  })
})

describe("ordering + timestamps", () => {
  test("a late event with an older ts sorts by ts, ties by arrival", () => {
    const s = feed([ev({ type: "busy", ts: NOW - 10, eventId: "o-2" }), ev({ type: "prompt", ts: NOW - 20, eventId: "o-1" }), ev({ type: "idle", ts: NOW - 10, eventId: "o-3" })])
    assert.deepEqual(types(s), ["prompt:o-1", "busy:o-2", "idle:o-3"])
  })
  test("invalid ts (NaN, <=0, string, >5 min future) => tsValid false, ordered by arrival, excluded from time filters", () => {
    let s = initialInteractionState
    s = live(s, ev({ type: "activity", ts: NOW - 1000, eventId: "t-1" }), NOW)
    s = live(s, ev({ type: "activity", ts: NOW + 10 * 60_000, eventId: "t-2" }), NOW + 1)
    s = live(s, ev({ type: "activity", ts: -5, eventId: "t-3" }), NOW + 2)
    s = live(s, ev({ type: "activity", ts: "soon", eventId: "t-4" }), NOW + 3)
    assert.deepEqual(s.entries.map((e) => [e.ev.eventId, e.tsValid]), [["t-1", true], ["t-2", false], ["t-3", false], ["t-4", false]])
    const idx = buildIndex(s.entries)
    const recent = filterEntries(s.entries, { kinds: ["activity"], sinceMs: 60_000 }, idx, NOW + 5)
    assert.deepEqual(recent.map((e) => e.ev.eventId), ["t-1"])
  })
})

describe("duration + delivery", () => {
  const d = ev({ type: "dispatch", ts: NOW - 5000, eventId: "d-1", target: "coder", correlationId: "claude:toolu_1", text: "Implement" })
  test("pending until handback; then the handback status", () => {
    let s = feed([d])
    let idx = buildIndex(s.entries)
    assert.equal(deliveryStatus(s.entries[0], idx), "pending")
    s = live(s, ev({ type: "handback", ts: NOW, eventId: "d-2", agent: "coder", target: "orchestrator", correlationId: "claude:toolu_1", status: "error", error: "boom" }))
    idx = buildIndex(s.entries)
    assert.equal(deliveryStatus(s.entries[0], idx), "error")
    assert.equal(rowStatus(s.entries[1], idx), "error")
  })
  test("no correlationId => unknown", () => {
    const s = feed([ev({ type: "dispatch", ts: NOW, eventId: "u-1", target: "coder" })])
    assert.equal(deliveryStatus(s.entries[0], buildIndex(s.entries)), "unknown")
  })
  test("producer durationMs wins; else handback.ts - dispatch.ts; else empty", () => {
    let s = feed([d, ev({ type: "handback", ts: NOW, eventId: "d-3", agent: "coder", target: "orchestrator", correlationId: "claude:toolu_1", status: "ok", durationMs: 1234 })])
    let idx = buildIndex(s.entries)
    assert.equal(durationOf(s.entries[1], idx), 1234)
    assert.equal(durationOf(s.entries[0], idx), 1234)
    s = feed([d, ev({ type: "handback", ts: NOW, eventId: "d-4", agent: "coder", target: "orchestrator", correlationId: "claude:toolu_1", status: "ok" })])
    idx = buildIndex(s.entries)
    assert.equal(durationOf(s.entries[1], idx), 5000)
    s = feed([d, ev({ type: "handback", ts: "bad", eventId: "d-5", agent: "coder", correlationId: "claude:toolu_1", status: "ok", durationMs: -3 })])
    assert.equal(durationOf(s.entries.find((e) => e.ev.type === "handback"), buildIndex(s.entries)), undefined)
    s = feed([ev({ type: "handback", ts: NOW, eventId: "d-6", agent: "coder", correlationId: "claude:other", status: "ok" })])
    assert.equal(durationOf(s.entries[0], buildIndex(s.entries)), undefined)
  })
})

describe("agent task status (lifecycle only)", () => {
  const status = (events, id) => agentSummaries(feed(events.map((e, i) => ev({ ts: NOW - 1000 + i, eventId: `s-${i}`, ...e }))).entries).get(id)
  test("dispatch received => working; idle after working => done", () => {
    assert.equal(status([{ type: "dispatch", target: "coder" }], "coder").status, "working")
    assert.equal(status([{ type: "dispatch", target: "coder" }, { type: "idle", agent: "coder" }], "coder").status, "done")
  })
  test("idle without prior work stays unknown", () => {
    assert.equal(status([{ type: "idle", agent: "coder" }], "coder").status, "unknown")
  })
  test("handback ok => done; handback error => error", () => {
    assert.equal(status([{ type: "busy", agent: "coder" }, { type: "handback", agent: "coder", target: "orchestrator", status: "ok" }], "coder").status, "done")
    assert.equal(status([{ type: "busy", agent: "coder" }, { type: "handback", agent: "coder", target: "orchestrator", status: "error" }], "coder").status, "error")
  })
  test("error without toolName => error; a tool error does NOT change task status (badge only)", () => {
    assert.equal(status([{ type: "prompt" }, { type: "error", text: "crash" }], "orchestrator").status, "error")
    const s = status([{ type: "prompt" }, { type: "error", text: "Bash gagal", toolName: "Bash" }], "orchestrator")
    assert.equal(s.status, "working"); assert.equal(s.toolErrors, 1)
  })
  test("summaries: message count, last task, requestedAgent, last activity", () => {
    const m = agentSummaries(
      feed([
        ev({ type: "prompt", ts: NOW - 30, eventId: "m-1", text: "build it" }),
        ev({ type: "dispatch", ts: NOW - 20, eventId: "m-2", target: "scout", requestedAgent: "general-purpose", text: "Find auth", correlationId: "c1" }),
        ev({ type: "handback", ts: NOW - 10, eventId: "m-3", agent: "scout", target: "orchestrator", requestedAgent: "general-purpose", status: "ok", correlationId: "c1" }),
        ev({ type: "activity", ts: NOW - 5, eventId: "m-4", agent: "scout", text: "grep" }),
      ]).entries,
    )
    const orch = m.get("orchestrator"), scout = m.get("scout")
    assert.equal(orch.messages, 3); assert.equal(orch.lastTask, "build it"); assert.equal(orch.status, "working")
    assert.equal(scout.messages, 2); assert.equal(scout.lastTask, "Find auth"); assert.deepEqual(scout.requested, ["general-purpose"])
    assert.equal(scout.status, "done"); assert.equal(scout.lastTs, NOW - 5)
    assert.equal(m.get("user"), undefined)
  })
  test("orchestrator aliases are normalised (build/plan/general)", () => {
    assert.ok(agentSummaries(feed([ev({ type: "prompt", agent: "build", ts: NOW, eventId: "al-1" })]).entries).has("orchestrator"))
  })
})

describe("filters + search + links", () => {
  const s = feed([
    ev({ type: "prompt", ts: NOW - 50, eventId: "f-1", text: "Add reset password" }),
    ev({ type: "dispatch", ts: NOW - 40, eventId: "f-2", target: "coder", text: "Implement page", correlationId: "opencode:child1", childSessionID: "child1", sessionID: "root" }),
    ev({ type: "busy", ts: NOW - 39, eventId: "f-3", agent: "coder", sessionID: "child1", childSessionID: "child1", correlationId: "opencode:child1" }),
    ev({ type: "activity", ts: NOW - 30, eventId: "f-4", agent: "coder", sessionID: "child1", text: "edit page.dart" }),
    ev({ type: "lock.acquired", ts: NOW - 29, eventId: "f-5", agent: "coder", feature: "auth" }),
    ev({ type: "handback", ts: NOW - 20, eventId: "f-6", agent: "coder", target: "orchestrator", sessionID: "child1", correlationId: "opencode:child1", status: "ok", result: "Done: ResetPasswordPage" }),
    ev({ type: "dispatch", ts: NOW - 10, eventId: "f-7", target: "reviewer", text: "Review", correlationId: "claude:t2" }),
  ])
  const idx = buildIndex(s.entries)
  const ids = (f) => filterEntries(s.entries, f, idx, NOW).map((e) => e.ev.eventId)
  test("default kinds hide activity/lifecycle/lock", () => {
    assert.deepEqual(ids({ kinds: DEFAULT_KINDS }), ["f-1", "f-2", "f-6", "f-7"])
    assert.deepEqual(ids({ kinds: [...DEFAULT_KINDS, "lock"] }), ["f-1", "f-2", "f-5", "f-6", "f-7"])
  })
  test("sender / receiver / agent / status", () => {
    assert.deepEqual(ids({ sender: "user" }), ["f-1"])
    assert.deepEqual(ids({ receiver: "orchestrator" }), ["f-1", "f-6"])
    assert.deepEqual(ids({ agent: "reviewer" }), ["f-7"])
    assert.deepEqual(ids({ status: "pending" }), ["f-7"])
    assert.deepEqual(ids({ status: "ok", kinds: DEFAULT_KINDS }), ["f-2", "f-6"])
  })
  test("search covers text, result and ids, case-insensitive", () => {
    assert.deepEqual(ids({ search: "resetpasswordpage" }), ["f-6"])
    assert.deepEqual(ids({ search: "CLAUDE:T2" }), ["f-7"])
    assert.deepEqual(ids({ search: "child1", kinds: ["dispatch"] }), ["f-2"])
  })
  test("correlation isolate includes the OpenCode child session", () => {
    assert.deepEqual(ids({ correlationId: "opencode:child1" }), ["f-2", "f-3", "f-4", "f-6"])
  })
  test("linkedEvents: same correlationId plus child-session events", () => {
    const d = s.entries.find((e) => e.ev.eventId === "f-2")
    assert.deepEqual(linkedEvents(d, s.entries, idx).map((e) => e.ev.eventId), ["f-3", "f-4", "f-6"])
    const r = s.entries.find((e) => e.ev.eventId === "f-1")
    assert.deepEqual(linkedEvents(r, s.entries, idx), [])
  })
  test("shortCorr", () => {
    assert.equal(shortCorr("claude:toolu_01ABCDEFGHIJKL"), "claude:…EFGHIJKL")
    assert.equal(shortCorr("abc"), "abc")
  })
})

describe("guards", () => {
  test("demo events (no source, demo-* session) are never stored", () => {
    const s = feed([{ type: "prompt", agent: "orchestrator", sessionID: "demo-orchestrator", ts: NOW, text: "x" }])
    assert.equal(s.entries.length, 0)
    const t = feed([{ type: "prompt", agent: "orchestrator", sessionID: "demo-x", source: "claude", ts: NOW, eventId: "g-1" }])
    assert.equal(t.entries.length, 1)
  })
  test("UI masking: secrets are masked at ingest (and therefore not searchable)", () => {
    const s = feed([
      ev({ type: "dispatch", ts: NOW, eventId: "sec-1", target: "coder", prompt: "use key sk-abcdefghijklmnopqrstu and password=hunter2", token: "raw-token-value", sessionID: "claude:S" }),
    ])
    const e = s.entries[0].ev
    assert.doesNotMatch(e.prompt, /sk-abcdef|hunter2/)
    assert.equal(e.token, "***")
    assert.equal(e.sessionID, "claude:S") // routing ids are not masked
    const idx = buildIndex(s.entries)
    assert.equal(filterEntries(s.entries, { search: "hunter2" }, idx, NOW).length, 0)
  })
})

describe("review round 1", () => {
  const d = ev({ type: "dispatch", ts: NOW - 50, eventId: "r-1", target: "scout", correlationId: "claude:toolu_9", text: "Find" })
  test("dispatch stays pending while the dispatcher works, becomes unknown once it goes idle (Stop) with no handback", () => {
    let s = feed([d, ev({ type: "activity", ts: NOW - 40, eventId: "r-2", text: "read" })])
    assert.equal(deliveryStatus(s.entries[0], buildIndex(s.entries)), "pending")
    // A subagent's SubagentStop idle (different agent) does not settle it.
    s = live(s, ev({ type: "idle", ts: NOW - 30, eventId: "r-3", agent: "scout" }))
    assert.equal(deliveryStatus(s.entries[0], buildIndex(s.entries)), "pending")
    s = live(s, ev({ type: "idle", ts: NOW - 20, eventId: "r-4" })) // orchestrator Stop, same session
    assert.equal(deliveryStatus(s.entries[0], buildIndex(s.entries)), "unknown")
    assert.equal(filterEntries(s.entries, { status: "pending" }, buildIndex(s.entries), NOW).length, 0)
  })
  test("an idle BEFORE the dispatch or in another session does not settle it; a late handback still wins", () => {
    let s = feed([ev({ type: "idle", ts: NOW - 60, eventId: "r-0" }), d, ev({ type: "idle", ts: NOW - 10, eventId: "r-5", sessionID: "claude:OTHER" })])
    const di = () => s.entries.find((e) => e.ev.eventId === "r-1")
    assert.equal(deliveryStatus(di(), buildIndex(s.entries)), "pending")
    s = live(s, ev({ type: "idle", ts: NOW - 5, eventId: "r-6" }))
    s = live(s, ev({ type: "handback", ts: NOW, eventId: "r-7", agent: "scout", target: "orchestrator", correlationId: "claude:toolu_9", status: "ok" }))
    assert.equal(deliveryStatus(di(), buildIndex(s.entries)), "ok")
  })
  test("reply count and thread root", () => {
    const s = feed([
      d,
      ev({ type: "error", ts: NOW - 40, eventId: "r-8", toolName: "Task", correlationId: "claude:toolu_9" }),
      ev({ type: "handback", ts: NOW - 30, eventId: "r-9", agent: "scout", target: "orchestrator", correlationId: "claude:toolu_9", status: "error" }),
      ev({ type: "prompt", ts: NOW - 20, eventId: "r-10" }),
    ])
    const idx = buildIndex(s.entries)
    const [disp, , hb, pr] = s.entries
    assert.equal(replyCount(disp, idx), 2)
    assert.equal(replyCount(hb, idx), 0) // only dispatch rows carry the chip
    assert.equal(threadRootOf(hb, idx), disp)
    assert.equal(threadRootOf(pr, idx), pr)
  })
  test("scout is pinned with the required agents", () => {
    for (const id of ["orchestrator", "scout", "architect", "coder", "reviewer"]) assert.ok(PINNED_AGENTS.includes(id), id)
  })
})

describe("review round 2: no ok/done without evidence", () => {
  const d1 = ev({ type: "dispatch", ts: NOW - 50, eventId: "w-1", target: "coder", correlationId: "claude:A", text: "A" })
  const d2 = ev({ type: "dispatch", ts: NOW - 49, eventId: "w-2", target: "scout", correlationId: "claude:B", text: "B" })
  test("background launch handback (status unknown): delivery unknown, agent stays working, no duration, neutral badge", () => {
    const s = feed([d1, ev({ type: "handback", ts: NOW - 40, eventId: "w-3", agent: "coder", target: "orchestrator", correlationId: "claude:A", status: "unknown", text: "launched" })])
    const idx = buildIndex(s.entries)
    assert.equal(deliveryStatus(s.entries[0], idx), "unknown")
    assert.equal(agentSummaries(s.entries).get("coder").status, "working")
    assert.equal(durationOf(s.entries[0], idx), undefined); assert.equal(durationOf(s.entries[1], idx), undefined)
    assert.equal(badgeOf(s.entries[1].ev), "lifecycle")
  })
  test("parallel Tasks: an orchestrator-labelled SubagentStop (reason subagent-stop) does not flip other dispatches to unknown", () => {
    let s = feed([d1, d2, ev({ type: "handback", ts: NOW - 30, eventId: "w-4", agent: "coder", target: "orchestrator", correlationId: "claude:A", status: "ok" })])
    s = live(s, ev({ type: "idle", ts: NOW - 29, eventId: "w-5", reason: "subagent-stop" }))
    const dB = () => s.entries.find((e) => e.ev.eventId === "w-2")
    assert.equal(deliveryStatus(dB(), buildIndex(s.entries)), "pending")
    s = live(s, ev({ type: "idle", ts: NOW - 10, eventId: "w-6" })) // the real Stop
    assert.equal(deliveryStatus(dB(), buildIndex(s.entries)), "unknown")
  })
  test("reply chip counts the same set as the thread (OpenCode child-session events included)", () => {
    const s = feed([
      ev({ type: "dispatch", ts: NOW - 40, eventId: "w-7", target: "coder", correlationId: "opencode:c1", childSessionID: "c1", sessionID: "root" }),
      ev({ type: "busy", ts: NOW - 39, eventId: "w-8", agent: "coder", sessionID: "c1", childSessionID: "c1", correlationId: "opencode:c1" }),
      ev({ type: "activity", ts: NOW - 30, eventId: "w-9", agent: "coder", sessionID: "c1", text: "edit" }),
      ev({ type: "error", ts: NOW - 25, eventId: "w-10", agent: "coder", sessionID: "c1", toolName: "bash" }),
      ev({ type: "handback", ts: NOW - 20, eventId: "w-11", agent: "coder", sessionID: "c1", childSessionID: "c1", correlationId: "opencode:c1", status: "ok" }),
    ])
    const idx = buildIndex(s.entries)
    const root = s.entries[0]
    assert.equal(replyCount(root, idx), linkedEvents(root, s.entries, idx).length)
    assert.equal(replyCount(root, idx), 4)
  })
})

describe("Hermes Agent OS", () => {
  test("hermes (orchestrator and its OpenCode relay agent) maps to the orchestrator slot", () => {
    const s = feed([
      { type: "dispatch", agent: "hermes", target: "scout", source: "hermes", sessionID: "agentos:T-1", taskId: "T-1", correlationId: "agentos:ex_1", ts: NOW - 20, eventId: "h-1", text: "Find auth" },
      { type: "handback", agent: "scout", target: "hermes", source: "hermes", sessionID: "agentos:T-1", taskId: "T-1", correlationId: "agentos:ex_1", status: "ok", ts: NOW - 10, eventId: "h-2" },
    ])
    const sums = agentSummaries(s.entries)
    assert.ok(sums.has("orchestrator"))
    assert.ok(!sums.has("hermes"))
    assert.equal(s.entries[0].ev.taskId, "T-1")
  })
})
