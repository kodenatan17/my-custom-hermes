import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  agentEntries,
  buildIndex,
  buildRooms,
  partnersOf,
  dayKey,
  dayLabel,
  groupByDay,
  initialInteractionState,
  initialsOf,
  interactionReducer,
  isSystemEntry,
  ownerOf,
  pairOf,
  replyQuote,
  resolveRoomId,
  roomEntries,
  sideOf,
} from "../src/chat/model.mjs"

const NOW = 1_700_000_000_000
const ev = (o) => ({ source: "claude", sessionID: "claude:S", agent: "orchestrator", ...o })
const feed = (events, now = NOW) => events.reduce((s, e) => interactionReducer(s, { type: "event", event: e, now }), initialInteractionState).entries
const disp = (n, agent, target, extra = {}) => ev({ type: "dispatch", agent, target, ts: NOW - 1000 + n, eventId: `b-${n}`, correlationId: `c${n}`, text: `task ${n}`, ...extra })
const back = (n, agent, target, extra = {}) => ev({ type: "handback", agent, target, ts: NOW - 1000 + n, eventId: `b-${n}`, correlationId: `c${n - 1}`, status: "ok", result: "done", ...extra })

describe("pair detection", () => {
  test("dispatch and handback (both directions) share one pair room", () => {
    const entries = feed([disp(1, "orchestrator", "coder"), back(2, "coder", "orchestrator")])
    assert.deepEqual(pairOf(entries[0]), ["coder", "orchestrator"])
    assert.deepEqual(pairOf(entries[1]), ["coder", "orchestrator"])
    const rooms = buildRooms(entries)
    assert.equal(rooms.length, 1)
    assert.equal(rooms[0].id, "pair:coder|orchestrator")
    assert.equal(rooms[0].name, "orchestrator ↔ coder")
    assert.equal(rooms[0].counterpart, "coder")
    assert.equal(rooms[0].count, 2)
  })
  test("self-dispatch, unknown agents, and missing target are not pairs", () => {
    const entries = feed([
      disp(1, "coder", "coder"),
      ev({ type: "dispatch", agent: "orchestrator", ts: NOW - 500, eventId: "b-9" }),
      ev({ type: "dispatch", agent: "orchestrator", target: "unknown", ts: NOW - 400, eventId: "b-10" }),
    ])
    assert.ok(entries.every((e) => pairOf(e) === null))
    assert.deepEqual(buildRooms(entries).map((r) => r.id).sort(), ["agent:coder", "agent:orchestrator"])
  })
})

describe("initiator and sides", () => {
  test("first dispatch sender is the initiator (even if the other side speaks first in time order of handback)", () => {
    const entries = feed([disp(1, "architect", "coder"), disp(2, "coder", "architect"), back(3, "coder", "architect")])
    const [room] = buildRooms(entries)
    assert.equal(room.initiator, "architect")
    assert.equal(room.name, "architect ↔ coder")
    assert.equal(sideOf(entries[0], room), "out")
    assert.equal(sideOf(entries[1], room), "in")
  })
  test("handback-only room: initiator is the handback receiver", () => {
    const entries = feed([back(2, "coder", "orchestrator")])
    const [room] = buildRooms(entries)
    assert.equal(room.initiator, "orchestrator")
    assert.equal(sideOf(entries[0], room), "in")
  })
  test("agent room: own messages are out; All room is always in", () => {
    const entries = feed([ev({ type: "prompt", agent: "orchestrator", ts: NOW - 5, eventId: "b-1", text: "hi" }), ev({ type: "error", agent: "orchestrator", ts: NOW - 4, eventId: "b-2", text: "x" })])
    const [room] = buildRooms(entries)
    assert.equal(sideOf(entries[0], room), "in") // sender is user
    assert.equal(sideOf(entries[1], room), "out")
    assert.equal(sideOf(entries[1], undefined), "in")
  })
})

describe("own-activity rooms + membership", () => {
  const entries = feed([
    ev({ type: "prompt", agent: "orchestrator", ts: NOW - 50, eventId: "b-1", text: "build it" }),
    disp(2, "orchestrator", "coder"),
    ev({ type: "busy", agent: "coder", ts: NOW - 900, eventId: "b-3" }),
    ev({ type: "error", agent: "coder", toolName: "bash", ts: NOW - 800, eventId: "b-4", text: "fail" }),
    ev({ type: "error", agent: "reviewer", ts: NOW - 700, eventId: "b-5", text: "boom" }),
  ])
  const rooms = buildRooms(entries)
  test("prompt/lifecycle/errors form per-agent rooms; no counterpart needed", () => {
    assert.deepEqual(rooms.map((r) => r.id).sort(), ["agent:coder", "agent:orchestrator", "agent:reviewer", "pair:coder|orchestrator"])
    assert.equal(ownerOf(entries.find((e) => e.ev.type === "prompt")), "orchestrator")
  })
  test("agent room only holds own non-pair entries; pair room adds members' system entries but not prompts", () => {
    const orch = rooms.find((r) => r.id === "agent:orchestrator")
    assert.deepEqual(roomEntries(orch, entries).map((e) => e.ev.type), ["prompt"])
    const pair = rooms.find((r) => r.type === "pair")
    assert.deepEqual(roomEntries(pair, entries).map((e) => e.ev.type).sort(), ["busy", "dispatch", "error"])
    assert.equal(roomEntries(undefined, entries).length, entries.length)
  })
  test("tool errors and lifecycle are system entries; agent errors are bubbles", () => {
    const by = (id) => entries.find((e) => e.ev.eventId === id)
    assert.equal(isSystemEntry(by("b-3")), true)
    assert.equal(isSystemEntry(by("b-4")), true)
    assert.equal(isSystemEntry(by("b-5")), false)
    assert.equal(isSystemEntry(by("b-2")), false)
  })
  test("lastMsg skips system entries", () => {
    const coder = rooms.find((r) => r.id === "agent:coder")
    assert.equal(coder.last.ev.type, "error")
    assert.equal(coder.lastMsg.ev.type, "busy") // only system entries -> falls back to the first seen
  })
})

describe("sorting, unread, invalid ts, dedupe", () => {
  test("rooms sort by last activity, newest first", () => {
    const entries = feed([disp(1, "orchestrator", "coder"), disp(2, "orchestrator", "scout"), back(5, "coder", "orchestrator")])
    assert.deepEqual(buildRooms(entries).map((r) => r.counterpart), ["coder", "scout"])
  })
  test("unread per room: baseline null = 0; counts messages at/after max(baseline, seen[roomId])", () => {
    const entries = feed([disp(1, "orchestrator", "coder"), back(2, "coder", "orchestrator"), disp(3, "orchestrator", "scout")])
    assert.deepEqual(buildRooms(entries, null).map((r) => r.unread), [0, 0])
    assert.deepEqual(buildRooms(entries, 1).map((r) => [r.counterpart, r.unread]), [["scout", 1], ["coder", 1]])
    assert.deepEqual(buildRooms(entries, 0, { "pair:coder|orchestrator": 2 }).map((r) => [r.counterpart, r.unread]), [["scout", 1], ["coder", 0]])
  })
  test("system entries never count as unread", () => {
    const entries = feed([ev({ type: "busy", agent: "coder", ts: NOW - 5, eventId: "b-1" })])
    assert.equal(buildRooms(entries, 0)[0].unread, 0)
  })
  test("fingerprint key is built from masked text (no raw secret in keys)", () => {
    const secret = "sk-ant-api03-" + "A".repeat(40)
    const [e] = feed([ev({ type: "activity", ts: NOW - 5, text: "key " + secret })])
    assert.ok(!e.key.includes(secret))
  })
  test("invalid ts orders by arrival and does not crash; duplicates collapse", () => {
    const entries = feed([disp(1, "orchestrator", "coder", { ts: "bad" }), disp(1, "orchestrator", "coder", { ts: "bad" }), disp(2, "orchestrator", "coder", { ts: NOW - 5 })])
    assert.equal(entries.length, 2)
    const [room] = buildRooms(entries)
    assert.equal(room.count, 2)
    assert.equal(room.last.ev.eventId, "b-1") // invalid ts sorts by arrival time (NOW), after the valid NOW-5
    assert.equal(buildRooms([]).length, 0)
  })
})

describe("resolveRoomId", () => {
  test("keeps an existing room, falls back to All when it vanished", () => {
    const rooms = buildRooms(feed([disp(1, "orchestrator", "coder")]))
    assert.equal(resolveRoomId(rooms, "pair:coder|orchestrator"), "pair:coder|orchestrator")
    assert.equal(resolveRoomId(rooms, "pair:gone|x"), "all")
    assert.equal(resolveRoomId([], "all"), "all")
  })
})

describe("quote + day grouping + initials", () => {
  test("handback quotes its dispatch; dispatch and orphan handback do not", () => {
    const entries = feed([disp(1, "orchestrator", "coder"), back(2, "coder", "orchestrator"), back(4, "coder", "orchestrator", { correlationId: "zzz" })])
    const index = buildIndex(entries)
    assert.equal(replyQuote(entries[1], index), entries[0])
    assert.equal(replyQuote(entries[0], index), undefined)
    assert.equal(replyQuote(entries[2], index), undefined)
  })
  test("groupByDay splits on local midnight; dayLabel Today/Yesterday/date", () => {
    const noon = new Date(2026, 2, 12, 12, 0).getTime()
    const prev = new Date(2026, 2, 11, 23, 59).getTime()
    const old = new Date(2026, 0, 5, 9, 0).getTime()
    const e = (ts, n) => ({ sortTs: ts, seq: n })
    const g = groupByDay([e(old, 0), e(prev, 1), e(prev + 1, 2), e(noon, 3)])
    assert.deepEqual(g.map((x) => x.entries.length), [1, 2, 1])
    assert.equal(g[2].key, dayKey(noon))
    assert.equal(dayLabel(noon, noon + 60_000), "Today")
    assert.equal(dayLabel(prev, noon), "Yesterday")
    assert.match(dayLabel(old, noon), /5 Jan 2026/)
    assert.deepEqual(groupByDay([]), [])
  })
  test("initialsOf", () => {
    assert.equal(initialsOf("coder"), "CO")
    assert.equal(initialsOf("memory-manager"), "MM")
    assert.equal(initialsOf(""), "?")
  })
})

describe("agent-first navigation (agents -> partners -> pair room)", () => {
  // hermes (normalised to "orchestrator") talks to qa, coder and reviewer; coder also hands work to reviewer; scout only has its own activity.
  const entries = () =>
    feed([
      disp(1, "hermes", "qa"),
      back(2, "qa", "hermes"),
      disp(3, "hermes", "coder"),
      back(4, "coder", "hermes"),
      disp(5, "coder", "reviewer"),
      disp(6, "hermes", "reviewer"),
      ev({ type: "activity", agent: "scout", ts: NOW - 900, eventId: "b-50", toolName: "read" }),
    ])

  test("agentEntries: one row per agent in a pair room, orchestrator first, no 'All' and no activity-only agents", () => {
    const agents = agentEntries(buildRooms(entries()))
    assert.deepEqual(agents.map((a) => a.id), ["orchestrator", "reviewer", "coder", "qa"]) // then newest message first
    assert.ok(!agents.some((a) => a.id === "all" || a.id === "scout" || a.id === "hermes"))
    assert.equal(agents.find((a) => a.id === "orchestrator").partners, 3)
    assert.equal(agents.find((a) => a.id === "coder").partners, 2)
    assert.equal(agents.find((a) => a.id === "orchestrator").last.ev.eventId, "b-6")
  })

  test("agentEntries: unread is summed over the agent's rooms; orchestrator stays first even when not the newest", () => {
    // The orchestrator's message is the OLDEST here, yet it is still listed first; the rest follow newest first.
    const e = feed([disp(1, "orchestrator", "coder"), disp(2, "coder", "reviewer")])
    const agents = agentEntries(buildRooms(e, 0))
    assert.deepEqual(agents.map((a) => a.id), ["orchestrator", "coder", "reviewer"])
    const coder = agents.find((a) => a.id === "coder")
    assert.equal(coder.unread, 2) // one unread message in each of its two rooms
    assert.equal(agents.find((a) => a.id === "orchestrator").unread, 1)
  })

  test("partnersOf: the other member of each pair room, both directions, newest message first", () => {
    const rooms = buildRooms(entries())
    assert.deepEqual(partnersOf(rooms, "orchestrator").map((p) => p.partner), ["reviewer", "coder", "qa"])
    assert.deepEqual(partnersOf(rooms, "coder").map((p) => p.partner), ["reviewer", "orchestrator"])
    assert.deepEqual(partnersOf(rooms, "qa").map((p) => p.partner), ["orchestrator"])
    const qa = partnersOf(rooms, "orchestrator").find((p) => p.partner === "qa")
    assert.equal(qa.room.id, "pair:orchestrator|qa")
    assert.deepEqual(roomEntries(qa.room, entries()).map((e) => e.ev.eventId), ["b-1", "b-2"])
  })

  test("partnersOf: an agent without pair rooms (own activity only, or unknown) has no partners", () => {
    const rooms = buildRooms(entries())
    assert.deepEqual(partnersOf(rooms, "scout"), [])
    assert.deepEqual(partnersOf(rooms, "nobody"), [])
    assert.deepEqual(agentEntries([]), [])
  })
})
