// Stage-4 QA gaps for the Agent Interaction Viewer store (src/chat/model.mjs):
// filter/search combos, 2000+ timeline, incomplete events, duplicates, task flows, timestamps, nested masking.
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  agentSummaries,
  badgeOf,
  buildIndex,
  compareEntries,
  DEFAULT_KINDS,
  deliveryStatus,
  durationOf,
  filterEntries,
  FUTURE_SKEW_MS,
  initialInteractionState,
  interactionReducer,
  MAX_ENTRIES,
  replyCount,
  rowStatus,
  summaryOf,
  buildRooms,
} from "../src/chat/model.mjs"

const NOW = 1_700_000_000_000
const ev = (o) => ({ source: "claude", sessionID: "claude:S", agent: "orchestrator", ...o })
const live = (state, event, now = NOW) => interactionReducer(state, { type: "event", event, now })
const hello = (state, replay, now = NOW) => interactionReducer(state, { type: "hello", replay, now })
const feed = (events, now = NOW, from = initialInteractionState) => events.reduce((s, e) => live(s, e, now), from)
const byId = (s, id) => s.entries.find((e) => e.ev.eventId === id)
const isSorted = (entries) => entries.every((e, i) => i === 0 || compareEntries(entries[i - 1], e) <= 0)

describe("filter + search combos", () => {
  const s = feed([
    ev({ type: "prompt", ts: NOW - 100, eventId: "q-1", text: "Add login" }),
    ev({ type: "dispatch", ts: NOW - 90, eventId: "q-2", target: "coder", correlationId: "claude:A", text: "Implement login" }),
    ev({ type: "error", ts: NOW - 80, eventId: "q-3", toolName: "Task", correlationId: "claude:A", text: "Task gagal" }),
    ev({ type: "handback", ts: NOW - 79, eventId: "q-4", agent: "coder", target: "orchestrator", correlationId: "claude:A", status: "error", error: "build failed" }),
    ev({ type: "dispatch", ts: NOW - 70, eventId: "q-5", target: "coder", correlationId: "claude:B", text: "Implement login retry" }),
    ev({ type: "activity", ts: NOW - 65, eventId: "q-6", agent: "coder", text: "edit login.dart" }),
    ev({ type: "handback", ts: NOW - 60, eventId: "q-7", agent: "coder", target: "orchestrator", correlationId: "claude:B", status: "ok", result: "Login done" }),
    ev({ type: "dispatch", ts: NOW - 10, eventId: "q-8", target: "reviewer", correlationId: "claude:C", text: "Review login" }),
    ev({ type: "dispatch", ts: NOW - 50_000, eventId: "q-9", target: "scout", requestedAgent: "general-purpose", correlationId: "claude:D", text: "Find auth" }),
    ev({ type: "handback", ts: NOW - 49_000, eventId: "q-10", agent: "scout", target: "orchestrator", correlationId: "claude:D", status: "unknown", text: "launched in background" }),
    ev({ type: "activity", ts: "garbage", eventId: "q-11", agent: "coder", text: "login probe" }),
  ])
  const idx = buildIndex(s.entries)
  const ids = (f) => filterEntries(s.entries, f, idx, NOW).map((e) => e.ev.eventId)

  test("sender + receiver + kind", () => {
    assert.deepEqual(ids({ sender: "orchestrator", receiver: "coder", kinds: ["dispatch"] }), ["q-2", "q-5"])
    assert.deepEqual(ids({ sender: "coder", receiver: "orchestrator", kinds: ["handback"] }), ["q-4", "q-7"])
  })
  test("sender + receiver + status (delivery status of the dispatch)", () => {
    assert.deepEqual(ids({ sender: "orchestrator", receiver: "coder", status: "ok" }), ["q-5"])
    assert.deepEqual(ids({ sender: "orchestrator", receiver: "coder", status: "error" }), ["q-2"])
  })
  test("sender + status error spans the failed dispatch and the tool error row", () => {
    assert.deepEqual(ids({ sender: "orchestrator", status: "error", kinds: DEFAULT_KINDS }), ["q-2", "q-3"])
    assert.deepEqual(ids({ receiver: "orchestrator", status: "error" }), ["q-4"])
  })
  test("correlationId + kind / status / search", () => {
    assert.deepEqual(ids({ correlationId: "claude:A" }), ["q-2", "q-3", "q-4"])
    assert.deepEqual(ids({ correlationId: "claude:A", kinds: ["error"] }), ["q-3"])
    assert.deepEqual(ids({ correlationId: "claude:A", kinds: ["handback"], status: "error" }), ["q-4"])
    assert.deepEqual(ids({ correlationId: "claude:A", search: "retry" }), [])
    assert.deepEqual(ids({ correlationId: "claude:B", search: "retry" }), ["q-5"])
  })
  test("search + time window + default kinds", () => {
    assert.deepEqual(ids({ search: "login", sinceMs: 30_000, kinds: DEFAULT_KINDS }), ["q-1", "q-2", "q-5", "q-7", "q-8"])
    // q-11 (invalid ts) matches the text but is excluded from any time window; it shows without one.
    assert.deepEqual(ids({ search: "login", sinceMs: 30_000, kinds: ["activity"] }), ["q-6"])
    assert.deepEqual(ids({ search: "login", kinds: ["activity"] }), ["q-6", "q-11"])
  })
  test("search + status; status unknown + time window", () => {
    assert.deepEqual(ids({ search: "login", status: "pending" }), ["q-8"])
    assert.deepEqual(ids({ status: "unknown" }), ["q-9", "q-10"])
    assert.deepEqual(ids({ status: "unknown", sinceMs: 30_000 }), [])
    assert.deepEqual(ids({ status: "unknown", sinceMs: 60_000 }), ["q-9", "q-10"])
  })
  test("agent channel + kind; requestedAgent is searchable; query is trimmed and case-folded", () => {
    assert.deepEqual(ids({ agent: "coder", kinds: ["handback"] }), ["q-4", "q-7"])
    assert.deepEqual(ids({ search: "GENERAL-purpose", kinds: ["dispatch"] }), ["q-9"])
    assert.deepEqual(ids({ search: "   LOGIN DONE  " }), ["q-7"])
  })
  test("empty filter returns everything (ordered); no-match combos return []", () => {
    assert.equal(ids({}).length, s.entries.length)
    assert.deepEqual(ids({ sender: "user", search: "nomatch" }), [])
    assert.deepEqual(ids({ sender: "coder", receiver: "reviewer" }), [])
    assert.deepEqual(ids({ correlationId: "claude:missing" }), [])
  })
  test("sinceMs 0 means no time filter (UI 'all')", () => {
    assert.equal(ids({ sinceMs: 0 }).length, s.entries.length)
  })
})

describe("timeline with 2000+ events", () => {
  // Deterministic shuffle so ts order != arrival order.
  const N = 2600
  const order = Array.from({ length: N }, (_, i) => i)
  let seed = 7
  for (let i = N - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    const j = seed % (i + 1)
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const mk = (i) => {
    const agent = ["coder", "scout", "reviewer", "architect"][i % 4]
    if (i % 10 === 0) return ev({ type: "dispatch", ts: NOW - 1_000_000 + i * 10, eventId: `L-${i}`, target: agent, correlationId: `c${i}`, text: `task ${i}` })
    if (i % 10 === 5) return ev({ type: "handback", ts: NOW - 1_000_000 + i * 10, eventId: `L-${i}`, agent, target: "orchestrator", correlationId: `c${i - 5}`, status: "ok" })
    return ev({ type: "activity", ts: NOW - 1_000_000 + i * 10, eventId: `L-${i}`, agent, text: `step ${i}` })
  }

  test("2600 live events one by one: capped at MAX_ENTRIES, keeps the newest by ts, ordered, < 1s", () => {
    const t0 = performance.now()
    const s = order.reduce((st, i) => live(st, mk(i)), initialInteractionState)
    const took = performance.now() - t0
    assert.equal(s.entries.length, MAX_ENTRIES)
    assert.equal(s.keys.size, MAX_ENTRIES)
    assert.ok(isSorted(s.entries), "sorted by (ts, seq)")
    // Newest 2000 by ts are indices 600..2599.
    assert.equal(s.entries[0].ev.eventId, `L-${N - MAX_ENTRIES}`)
    assert.equal(s.entries.at(-1).ev.eventId, `L-${N - 1}`)
    assert.equal(new Set(s.entries.map((e) => e.key)).size, MAX_ENTRIES)
    assert.ok(took < 1000, `ingest took ${took.toFixed(0)}ms`)
  })

  test("derivations over a full store (index, summaries, filters, reply chips) < 1s", () => {
    const s = hello(initialInteractionState, order.map(mk))
    const t0 = performance.now()
    const idx = buildIndex(s.entries)
    const sums = agentSummaries(s.entries)
    const f = filterEntries(s.entries, { kinds: DEFAULT_KINDS, search: "task", status: "ok" }, idx, NOW)
    let replies = 0
    for (const e of s.entries) replies += replyCount(e, idx)
    const took = performance.now() - t0
    assert.ok(sums.has("coder") && sums.has("orchestrator"))
    assert.ok(f.length > 0 && f.every((e) => e.ev.type === "dispatch"))
    assert.ok(replies > 0)
    assert.ok(took < 1000, `derivations took ${took.toFixed(0)}ms`)
  })

  test("a 500-event replay into a full store merges without duplicates and keeps the cap", () => {
    let s = hello(initialInteractionState, order.map(mk))
    const before = s.entries.map((e) => e.key)
    s = hello(s, Array.from({ length: 500 }, (_, k) => mk(N - 500 + k))) // all already held
    assert.deepEqual(s.entries.map((e) => e.key), before)
    // Replaying an event that was evicted by the cap does not grow the store beyond it.
    s = hello(s, [mk(0), mk(1)])
    assert.equal(s.entries.length, MAX_ENTRIES)
    assert.equal(s.entries[0].ev.eventId, `L-${N - MAX_ENTRIES}`)
  })
})

describe("incomplete events", () => {
  test("missing agent => sender 'unknown'; not counted as an agent channel or unread", () => {
    const s = feed([{ type: "error", source: "claude", sessionID: "x", ts: NOW, eventId: "i-1", text: "crash" }])
    assert.equal(s.entries.length, 1)
    assert.equal(s.entries[0].sender, "unknown")
    assert.equal(agentSummaries(s.entries).has("unknown"), false)
    assert.equal(buildRooms(s.entries, 0).length, 0)
  })
  test("missing ts => tsValid false, ordered by arrival (recvAt), excluded from time filters", () => {
    let s = live(initialInteractionState, ev({ type: "activity", eventId: "i-2", text: "no ts" }), NOW)
    s = live(s, ev({ type: "activity", ts: NOW - 5, eventId: "i-3" }), NOW + 1)
    assert.deepEqual(s.entries.map((e) => [e.ev.eventId, e.tsValid]), [["i-3", true], ["i-2", false]])
    assert.equal(s.entries[1].sortTs, NOW)
    assert.deepEqual(filterEntries(s.entries, { sinceMs: 60_000 }, buildIndex(s.entries), NOW + 2).map((e) => e.ev.eventId), ["i-3"])
  })
  test("missing / non-string type, primitives, arrays => parseErrors, nothing stored", () => {
    let s = initialInteractionState
    for (const bad of [{ agent: "coder", ts: NOW }, { type: 7, agent: "coder" }, "text", 42, [], undefined, true]) s = live(s, bad)
    assert.equal(s.parseErrors, 7)
    assert.equal(s.entries.length, 0)
  })
  test("non-JSON frame => parseError action; state otherwise untouched", () => {
    const s1 = feed([ev({ type: "busy", ts: NOW, eventId: "i-4" })])
    const s2 = interactionReducer(s1, { type: "parseError" })
    assert.equal(s2.parseErrors, 1)
    assert.equal(s2.entries, s1.entries)
  })
  test("hello with a non-array replay (null/object/string) does not crash and keeps entries", () => {
    let s = feed([ev({ type: "busy", ts: NOW, eventId: "i-5" })])
    for (const r of [null, { a: 1 }, "x", undefined]) s = hello(s, r)
    assert.equal(s.entries.length, 1)
    assert.equal(s.hellos, 4)
    assert.equal(s.historyDropped, false)
  })
  test("replay mixing garbage and good events keeps the good ones and counts the rest", () => {
    const s = hello(initialInteractionState, [null, ev({ type: "prompt", ts: NOW, eventId: "i-6" }), { nope: 1 }, ev({ type: "idle", ts: NOW, eventId: "i-7" })])
    assert.deepEqual(s.entries.map((e) => e.ev.eventId), ["i-6", "i-7"])
    assert.equal(s.parseErrors, 2)
  })
  test("unknown action type returns the same state", () => {
    const s = feed([ev({ type: "busy", ts: NOW, eventId: "i-8" })])
    assert.equal(interactionReducer(s, { type: "bogus" }), s)
  })
  test("dispatch without target, handback without status, unknown event type: no crash, neutral derivations", () => {
    const s = feed([
      ev({ type: "dispatch", ts: NOW - 3, eventId: "i-9", correlationId: "c-x" }),
      ev({ type: "handback", ts: NOW - 2, eventId: "i-10", agent: "coder", correlationId: "c-y" }),
      ev({ type: "weird.thing", ts: NOW - 1, eventId: "i-11" }),
    ])
    const idx = buildIndex(s.entries)
    const [d, h, w] = s.entries
    assert.equal(d.receiver, undefined)
    assert.equal(deliveryStatus(d, idx), "pending")
    assert.equal(rowStatus(h, idx), "unknown")
    assert.equal(badgeOf(h.ev), "lifecycle")
    assert.equal(durationOf(h, idx), undefined)
    assert.equal(summaryOf(h.ev), "status unknown")
    assert.equal(w.kind, "other"); assert.equal(badgeOf(w.ev), "other")
    assert.doesNotThrow(() => agentSummaries(s.entries))
  })
})

describe("duplicates", () => {
  test("same eventId twice live: first copy wins, second (even with different content) is dropped", () => {
    const s = feed([ev({ type: "prompt", ts: NOW, eventId: "dup-1", text: "first" }), ev({ type: "prompt", ts: NOW + 1, eventId: "dup-1", text: "second" })])
    assert.equal(s.entries.length, 1)
    assert.equal(s.entries[0].ev.text, "first")
  })
  test("same eventId twice inside one replay batch => kept once", () => {
    const e = ev({ type: "busy", ts: NOW, eventId: "dup-2" })
    const s = hello(initialInteractionState, [e, { ...e }, e])
    assert.equal(s.entries.length, 1)
  })
  test("live then reconnect hello overlapping on both sides: merged in ts order, no duplicates; identical second hello adds nothing", () => {
    let s = feed([ev({ type: "dispatch", ts: NOW - 20, eventId: "b-5", target: "coder", correlationId: "k" }), ev({ type: "busy", ts: NOW - 15, eventId: "b-6", agent: "coder" })])
    const replay = [
      ev({ type: "prompt", ts: NOW - 30, eventId: "b-4" }),
      ev({ type: "dispatch", ts: NOW - 20, eventId: "b-5", target: "coder", correlationId: "k" }),
      ev({ type: "busy", ts: NOW - 15, eventId: "b-6", agent: "coder" }),
      ev({ type: "handback", ts: NOW - 5, eventId: "b-7", agent: "coder", target: "orchestrator", correlationId: "k", status: "ok" }),
    ]
    s = hello(s, replay)
    assert.deepEqual(s.entries.map((e) => e.ev.eventId), ["b-4", "b-5", "b-6", "b-7"])
    assert.equal(s.historyDropped, true)
    const entries = s.entries
    s = hello(s, replay)
    assert.equal(s.entries, entries, "no new entries => same array (no re-sort)")
    assert.equal(s.hellos, 2)
    // The daemon's own live copy after the replay is also ignored.
    s = live(s, replay[3])
    assert.equal(s.entries.length, 4)
    assert.equal(deliveryStatus(byId(s, "b-5"), buildIndex(s.entries)), "ok")
  })
  test("historyDropped resets when a later replay starts at seq 0 (daemon restart)", () => {
    let s = hello(initialInteractionState, [ev({ type: "busy", ts: NOW, eventId: "boot1-9" })])
    assert.equal(s.historyDropped, true)
    s = hello(s, [ev({ type: "busy", ts: NOW + 1, eventId: "boot2-0" })])
    assert.equal(s.historyDropped, false)
    assert.equal(s.entries.length, 2)
  })
})

describe("task flows: running / failed / retry / done", () => {
  const run = [
    ev({ type: "prompt", ts: NOW - 100, eventId: "F-1", text: "Build login" }),
    ev({ type: "dispatch", ts: NOW - 90, eventId: "F-2", target: "coder", correlationId: "claude:T1", text: "Implement login" }),
    ev({ type: "busy", ts: NOW - 89, eventId: "F-3", agent: "coder" }),
    ev({ type: "activity", ts: NOW - 85, eventId: "F-4", agent: "coder", text: "edit login.dart" }),
    ev({ type: "error", ts: NOW - 84, eventId: "F-5", agent: "coder", toolName: "Bash", text: "Bash gagal" }),
  ]
  const fail = [
    ev({ type: "error", ts: NOW - 80, eventId: "F-6", toolName: "Task", correlationId: "claude:T1", text: "Task gagal" }),
    ev({ type: "handback", ts: NOW - 80, eventId: "F-7", agent: "coder", target: "orchestrator", correlationId: "claude:T1", status: "error", error: "tests failed" }),
  ]
  const retry = [ev({ type: "dispatch", ts: NOW - 70, eventId: "F-8", target: "coder", correlationId: "claude:T2", text: "Fix tests" })]
  const ok = [ev({ type: "handback", ts: NOW - 40, eventId: "F-9", agent: "coder", target: "orchestrator", correlationId: "claude:T2", status: "ok", result: "green" })]
  const done = [ev({ type: "idle", ts: NOW - 30, eventId: "F-10", agent: "coder" }), ev({ type: "idle", ts: NOW - 20, eventId: "F-11" })]

  test("running: coder working with a tool-error badge, dispatch pending, no duration", () => {
    const s = feed(run)
    const idx = buildIndex(s.entries)
    const coder = agentSummaries(s.entries).get("coder")
    assert.equal(coder.status, "working"); assert.equal(coder.toolErrors, 1)
    assert.equal(deliveryStatus(byId(s, "F-2"), idx), "pending")
    assert.equal(durationOf(byId(s, "F-2"), idx), undefined)
  })
  test("failed: handback error => coder error, delivery error; the Task tool error only badges the orchestrator", () => {
    const s = feed([...run, ...fail])
    const idx = buildIndex(s.entries)
    const sums = agentSummaries(s.entries)
    assert.equal(sums.get("coder").status, "error")
    assert.equal(sums.get("orchestrator").status, "working")
    assert.equal(sums.get("orchestrator").toolErrors, 1)
    assert.equal(deliveryStatus(byId(s, "F-2"), idx), "error")
    assert.equal(durationOf(byId(s, "F-2"), idx), 10)
    assert.equal(badgeOf(byId(s, "F-6").ev), "tool")
    assert.equal(badgeOf(byId(s, "F-7").ev), "error")
  })
  test("retry: new dispatch => coder working again with a clean badge; old task stays error, new one pending", () => {
    const s = feed([...run, ...fail, ...retry])
    const idx = buildIndex(s.entries)
    const coder = agentSummaries(s.entries).get("coder")
    assert.equal(coder.status, "working"); assert.equal(coder.toolErrors, 0); assert.equal(coder.lastTask, "Fix tests")
    assert.equal(deliveryStatus(byId(s, "F-2"), idx), "error")
    assert.equal(deliveryStatus(byId(s, "F-8"), idx), "pending")
  })
  test("retry ok then done: coder done, attempt 1 error / attempt 2 ok, status filters separate them", () => {
    const s = feed([...run, ...fail, ...retry, ...ok, ...done])
    const idx = buildIndex(s.entries)
    assert.equal(agentSummaries(s.entries).get("coder").status, "done")
    assert.equal(agentSummaries(s.entries).get("orchestrator").status, "done")
    assert.equal(deliveryStatus(byId(s, "F-2"), idx), "error")
    assert.equal(deliveryStatus(byId(s, "F-8"), idx), "ok")
    assert.equal(durationOf(byId(s, "F-8"), idx), 30)
    const ids = (f) => filterEntries(s.entries, f, idx, NOW).map((e) => e.ev.eventId)
    assert.deepEqual(ids({ kinds: ["dispatch"], status: "error" }), ["F-2"])
    assert.deepEqual(ids({ kinds: ["dispatch"], status: "ok" }), ["F-8"])
  })
  test("handback arriving before its dispatch (out of order) still resolves once both are present", () => {
    const s = feed([...retry.map((e) => ({ ...e })), ...ok].reverse())
    assert.equal(deliveryStatus(byId(s, "F-8"), buildIndex(s.entries)), "ok")
  })
  test("interrupted handback => delivery interrupted, neutral badge, duration still computed", () => {
    const s = feed([...retry, ev({ type: "handback", ts: NOW - 60, eventId: "F-12", agent: "coder", target: "orchestrator", correlationId: "claude:T2", status: "interrupted" })])
    const idx = buildIndex(s.entries)
    assert.equal(deliveryStatus(byId(s, "F-8"), idx), "interrupted")
    assert.equal(badgeOf(byId(s, "F-12").ev), "lifecycle")
    assert.equal(durationOf(byId(s, "F-8"), idx), 10)
  })
  test("background Task: handback unknown, then a subagent-stop idle and a coder SubagentStop leave delivery unknown", () => {
    const s = feed([
      ...retry,
      ev({ type: "handback", ts: NOW - 69, eventId: "F-13", agent: "coder", target: "orchestrator", correlationId: "claude:T2", status: "unknown" }),
      ev({ type: "idle", ts: NOW - 50, eventId: "F-14", reason: "subagent-stop" }),
      ev({ type: "idle", ts: NOW - 49, eventId: "F-15", agent: "coder" }),
    ])
    const idx = buildIndex(s.entries)
    assert.equal(deliveryStatus(byId(s, "F-8"), idx), "unknown")
    assert.equal(rowStatus(byId(s, "F-13"), idx), "unknown")
    assert.equal(agentSummaries(s.entries).get("coder").status, "done") // lifecycle idle, not the handback
  })
  test("subagent-stop idle alone does not settle a pending dispatch", () => {
    const s = feed([...retry, ev({ type: "idle", ts: NOW - 50, eventId: "F-16", reason: "subagent-stop" })])
    assert.equal(deliveryStatus(byId(s, "F-8"), buildIndex(s.entries)), "pending")
  })
})

describe("invalid and late timestamps", () => {
  test("validity boundaries: now+skew valid, +1ms invalid; NaN/Infinity/0/negative/string/null invalid", () => {
    const cases = [
      [NOW + FUTURE_SKEW_MS, true],
      [NOW + FUTURE_SKEW_MS + 1, false],
      [1, true],
      [0, false],
      [-1, false],
      [NaN, false],
      [Infinity, false],
      [String(NOW), false],
      [null, false],
    ]
    const s = feed(cases.map(([ts], i) => ev({ type: "activity", ts, eventId: `ts-${i}` })))
    for (const [i, [, valid]] of cases.entries()) assert.equal(byId(s, `ts-${i}`).tsValid, valid, `case ${i}`)
  })
  test("late arrival with an older ts lands in ts position; its idle-after-dispatch semantics follow ts, not arrival", () => {
    let s = feed([ev({ type: "idle", ts: NOW - 10, eventId: "late-2" })], NOW)
    s = live(s, ev({ type: "dispatch", ts: NOW - 50, eventId: "late-1", target: "coder", correlationId: "lc" }), NOW + 100)
    assert.deepEqual(s.entries.map((e) => e.ev.eventId), ["late-1", "late-2"])
    assert.equal(deliveryStatus(byId(s, "late-1"), buildIndex(s.entries)), "unknown")
  })
  test("clock skew: handback ts before dispatch ts => no negative duration", () => {
    const s = feed([
      ev({ type: "dispatch", ts: NOW, eventId: "sk-1", target: "coder", correlationId: "sk" }),
      ev({ type: "handback", ts: NOW - 500, eventId: "sk-2", agent: "coder", correlationId: "sk", status: "ok" }),
    ])
    const idx = buildIndex(s.entries)
    assert.equal(durationOf(byId(s, "sk-1"), idx), undefined)
    assert.equal(durationOf(byId(s, "sk-2"), idx), undefined)
  })
  test("invalid dispatch ts and no producer duration => no duration; invalid ts never sets lastTs", () => {
    const s = feed([
      ev({ type: "dispatch", ts: "bad", eventId: "iv-1", target: "coder", correlationId: "iv" }),
      ev({ type: "handback", ts: NOW, eventId: "iv-2", agent: "coder", correlationId: "iv", status: "ok" }),
      ev({ type: "activity", ts: NOW + 10 * FUTURE_SKEW_MS, eventId: "iv-3", agent: "scout" }),
    ])
    assert.equal(durationOf(byId(s, "iv-1"), buildIndex(s.entries)), undefined)
    assert.equal(agentSummaries(s.entries).get("scout").lastTs, undefined)
  })
  test("future-invalid ts is excluded from a time window even though it sorts at receive time", () => {
    const s = feed([ev({ type: "activity", ts: NOW + 2 * FUTURE_SKEW_MS, eventId: "fu-1" })])
    assert.equal(s.entries[0].sortTs, NOW)
    assert.equal(filterEntries(s.entries, { sinceMs: 60_000 }, buildIndex(s.entries), NOW).length, 0)
  })
  test("action without `now` falls back to Date.now()", () => {
    const s = interactionReducer(initialInteractionState, { type: "event", event: ev({ type: "busy", eventId: "nn-1" }) })
    assert.ok(Math.abs(s.entries[0].recvAt - Date.now()) < 5000)
  })
})

describe("UI store masking of nested payloads", () => {
  const raw = ev({
    type: "dispatch",
    ts: NOW,
    eventId: "mk-1",
    target: "coder",
    correlationId: "claude:toolu_mask",
    childSessionID: "child-1",
    prompt: "clone https://u:pass@host/repo and use sk-abcdefghijklmnopqrstuv",
    meta: {
      request: { headers: { Authorization: "Bearer abcdefghijklmnop", "x-trace": "ok" }, url: "https://h.io/cb?token=zzz123&x=1" },
      steps: [{ note: "password=hunter2" }, ["deep", { client_secret: "cs-raw" }], "ghp_abcdefghijklmnopqrstuvwxyz"],
      session_id: "raw-session-cookie",
    },
  })

  test("nested strings, arrays and secret-keyed values are masked; routing ids are kept", () => {
    const s = feed([raw])
    const e = s.entries[0].ev
    const json = JSON.stringify(e)
    assert.doesNotMatch(json, /u:pass@|sk-abcdef|abcdefghijklmnop|zzz123|hunter2|cs-raw|ghp_abc|raw-session-cookie/)
    assert.equal(e.meta.request.headers.Authorization, "***")
    assert.equal(e.meta.request.headers["x-trace"], "ok")
    assert.equal(e.meta.request.url, "https://h.io/cb?token=***&x=1")
    assert.equal(e.meta.steps[1][1].client_secret, "***")
    assert.equal(e.meta.session_id, "***")
    assert.match(e.prompt, /:\/\/\*\*\*:\*\*\*@host/)
    assert.equal(e.correlationId, "claude:toolu_mask")
    assert.equal(e.sessionID, "claude:S")
    assert.equal(e.childSessionID, "child-1")
    assert.equal(e.eventId, "mk-1")
  })
  test("the caller's raw object is not mutated (mask copies)", () => {
    feed([raw])
    assert.match(raw.prompt, /u:pass@/)
    assert.equal(raw.meta.steps[0].note, "password=hunter2")
  })
  test("very deep payloads collapse past depth 8 instead of leaking or throwing", () => {
    let deep = { note: "deepleak" } // a non-secret key: only the depth cap can hide it
    for (let i = 0; i < 12; i++) deep = { n: deep }
    const s = feed([ev({ type: "activity", ts: NOW, eventId: "mk-2", payload: deep })])
    assert.doesNotMatch(JSON.stringify(s.entries[0].ev), /deepleak/)
  })
  test("raw secrets cannot be found via search; masked ids still can", () => {
    const s = feed([raw])
    const idx = buildIndex(s.entries)
    for (const q of ["hunter2", "u:pass", "sk-abcdef"]) assert.equal(filterEntries(s.entries, { search: q }, idx, NOW).length, 0, q)
    assert.equal(filterEntries(s.entries, { search: "toolu_mask" }, idx, NOW).length, 1)
  })
  test("handback result / error fields are masked too", () => {
    const s = feed([
      ev({ type: "handback", ts: NOW, eventId: "mk-3", agent: "coder", correlationId: "m", status: "ok", result: "done, token: abc123secret" }),
      ev({ type: "handback", ts: NOW, eventId: "mk-4", agent: "coder", correlationId: "m2", status: "error", error: "auth failed for https://bob:pw1234@git.host" }),
    ])
    assert.doesNotMatch(JSON.stringify(s.entries.map((e) => e.ev)), /abc123secret|pw1234/)
  })
})
