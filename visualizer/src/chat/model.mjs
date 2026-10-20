// Agent Interaction Viewer: event store (reducer) + pure derivations (status, duration, filters, links).
// Plain JS with JSDoc types so `node --test` runs it without a build step; TS reads the JSDoc (allowJs).
// Fed ONLY from live bridge messages (useOfficeStream's WebSocket branch), never from the scripted demo.
import { maskDeep } from "../../../bridge/mask.mjs"

export const MAX_ENTRIES = 2000
/** Timestamps further than this into the future (vs. local receive time) are treated as invalid. */
export const FUTURE_SKEW_MS = 5 * 60_000
// scout is pinned too: the bridge relabels unknown subagent types to it, so it is usually the busiest channel.
export const PINNED_AGENTS = ["orchestrator", "scout", "architect", "coder", "reviewer", "memory-manager"]
export const ALL_KINDS = ["prompt", "dispatch", "handback", "error", "activity", "lifecycle", "lock", "other"]
export const DEFAULT_KINDS = ["prompt", "dispatch", "handback", "error"]
export const USER = "user"

// Same aliases as agents.ts normalizeAgent (kept here so this module stays importable from Node).
const ORCHESTRATOR_ALIASES = new Set(["orchestrator", "orchestrator-agent", "general", "build", "plan"])

/**
 * @typedef {{
 *   type: string, ts?: unknown, agent?: string, sessionID?: string, target?: string, text?: string, source?: string,
 *   eventId?: string, correlationId?: string, requestedAgent?: string, prompt?: string, result?: string, error?: string,
 *   status?: string, durationMs?: unknown, toolName?: string, childSessionID?: string, feature?: string, reason?: string,
 *   [k: string]: unknown
 * }} ChatEvent
 */
/**
 * @typedef {{ key: string, seq: number, recvAt: number, ev: ChatEvent, tsValid: boolean, sortTs: number,
 *   sender: string, receiver: string | undefined, kind: string }} Entry
 */
/**
 * @typedef {{ entries: Entry[], keys: Set<string>, seq: number, parseErrors: number, historyDropped: boolean, hellos: number }} InteractionState
 */
/**
 * @typedef {{ type: "hello", replay: unknown, now?: number }
 *   | { type: "event", event: unknown, now?: number }
 *   | { type: "parseError" }} InteractionAction
 */

/** @type {InteractionState} */
export const initialInteractionState = { entries: [], keys: new Set(), seq: 0, parseErrors: 0, historyDropped: false, hellos: 0 }

/** @param {unknown} raw @returns {string} */
export function normalizeId(raw) {
  if (typeof raw !== "string" || raw === "") return "unknown"
  return ORCHESTRATOR_ALIASES.has(raw) ? "orchestrator" : raw
}

/** Seq part of a daemon eventId `<boot>-<seq>`, or undefined. @param {unknown} eventId @returns {number | undefined} */
export function eventSeq(eventId) {
  const m = typeof eventId === "string" ? eventId.match(/-(\d+)$/) : null
  return m ? Number(m[1]) : undefined
}

/** Scripted demo events carry no source and a demo-* session; they never belong in the chat store. @param {any} raw */
export const isDemoEvent = (raw) => !raw.source && typeof raw.sessionID === "string" && raw.sessionID.startsWith("demo-")

/** Dedupe key: daemon eventId, else a content fingerprint. @param {any} ev @returns {string} */
export function eventKey(ev) {
  if (typeof ev.eventId === "string" && ev.eventId) return `id:${ev.eventId}`
  return `fp:${ev.ts}|${ev.type}|${ev.agent}|${ev.sessionID}|${ev.correlationId}|${ev.text}`
}

/** @param {unknown} ts @param {number} now */
export const validTs = (ts, now) => typeof ts === "number" && Number.isFinite(ts) && ts > 0 && ts <= now + FUTURE_SKEW_MS

/** Filter category of an event. @param {ChatEvent} ev @returns {string} */
export function kindOf(ev) {
  const t = ev.type
  if (t.startsWith("lock.")) return "lock"
  if (t === "busy" || t === "idle") return "lifecycle"
  if (t === "prompt" || t === "dispatch" || t === "handback" || t === "error" || t === "activity") return t
  return "other"
}

/** Visual badge style: sent | handback | lifecycle | tool | error | lock | other. @param {ChatEvent} ev */
export function badgeOf(ev) {
  switch (ev.type) {
    case "prompt":
    case "dispatch":
      return "sent"
    case "handback":
      // Only an ok handback gets the "delivered" style; unknown/interrupted are neutral.
      return ev.status === "error" ? "error" : ev.status === "ok" ? "handback" : "lifecycle"
    case "error":
      return isToolError(ev) ? "tool" : "error"
    case "activity":
      return "tool"
    case "busy":
    case "idle":
      return "lifecycle"
    default:
      return ev.type.startsWith("lock.") ? "lock" : "other"
  }
}

/** A tool failure (badge only), as opposed to an agent/task failure. @param {ChatEvent} ev */
export const isToolError = (ev) => ev.type === "error" && typeof ev.toolName === "string" && ev.toolName !== ""

/** @param {ChatEvent} ev @param {string} key @param {number} seq @param {number} now @returns {Entry} */
function makeEntry(ev, key, seq, now) {
  const tsValid = validTs(ev.ts, now)
  const kind = kindOf(ev)
  const sender = ev.type === "prompt" ? USER : normalizeId(ev.agent)
  const receiver =
    ev.type === "prompt" ? normalizeId(ev.agent) : ev.type === "dispatch" || ev.type === "handback" ? (ev.target ? normalizeId(ev.target) : undefined) : undefined
  return { key, seq, recvAt: now, ev, tsValid, sortTs: tsValid ? /** @type {number} */ (ev.ts) : now, sender, receiver, kind }
}

/** Order: (ts, arrival seq); invalid ts sorts by arrival time. @param {Entry} a @param {Entry} b */
export const compareEntries = (a, b) => a.sortTs - b.sortTs || a.seq - b.seq

/** @param {InteractionState} state @param {unknown[]} events @param {number} now @returns {InteractionState} */
function ingest(state, events, now) {
  /** @type {Set<string> | null} */
  let keys = null
  /** @type {Entry[]} */
  const added = []
  let seq = state.seq
  let parseErrors = state.parseErrors
  for (const raw of events) {
    if (!raw || typeof raw !== "object" || typeof (/** @type {any} */ (raw).type) !== "string") {
      parseErrors++
      continue
    }
    if (isDemoEvent(raw)) continue
    const key = eventKey(raw)
    if (state.keys.has(key) || keys?.has(key)) continue
    keys = keys ?? new Set(state.keys) // never mutate the previous state (StrictMode double-invokes reducers)
    keys.add(key)
    added.push(makeEntry(/** @type {ChatEvent} */ (maskDeep(raw)), key, seq++, now))
  }
  if (!added.length || !keys) return parseErrors === state.parseErrors ? state : { ...state, parseErrors }
  let entries = state.entries.concat(added).sort(compareEntries)
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(-MAX_ENTRIES)
    keys = new Set(entries.map((e) => e.key))
  }
  return { ...state, entries, keys, seq, parseErrors }
}

/** @param {InteractionState} state @param {InteractionAction} action @returns {InteractionState} */
export function interactionReducer(state, action) {
  switch (action.type) {
    case "parseError":
      return { ...state, parseErrors: state.parseErrors + 1 }
    case "event":
      return ingest(state, [action.event], action.now ?? Date.now())
    case "hello": {
      // Merge (not reset): a reconnect replays events we may already hold.
      const replay = Array.isArray(action.replay) ? action.replay : []
      const first = /** @type {any} */ (replay[0])
      const firstSeq = first && typeof first === "object" ? eventSeq(first.eventId) : undefined
      const next = ingest(state, replay, action.now ?? Date.now())
      return { ...next, historyDropped: firstSeq !== undefined && firstSeq > 0, hellos: state.hellos + 1 }
    }
    default:
      return state
  }
}

// ---- derivations ----

/** @typedef {{ dispatch?: Entry, handbacks: Entry[], childSessionID?: string }} CorrGroup */
/** @typedef {{ byCorr: Map<string, CorrGroup>, idles: Map<string, Entry[]>, entries: Entry[], replies: Map<string, number> }} EntryIndex */

/** @param {unknown} sessionID @param {string} agent */
const idleKey = (sessionID, agent) => `${sessionID}|${agent}`

/** @param {Entry[]} entries @returns {EntryIndex} */
export function buildIndex(entries) {
  /** @type {Map<string, CorrGroup>} */
  const byCorr = new Map()
  /** @type {Map<string, Entry[]>} idle events per (sessionID, agent), in order */
  const idles = new Map()
  for (const e of entries) {
    // A Claude SubagentStop without agent_type is labelled orchestrator; it says nothing about the orchestrator's own dispatches.
    if (e.ev.type === "idle" && e.ev.reason !== "subagent-stop") {
      const k = idleKey(e.ev.sessionID, e.sender)
      const list = idles.get(k)
      if (list) list.push(e)
      else idles.set(k, [e])
    }
    const c = e.ev.correlationId
    if (typeof c !== "string" || !c) continue
    let g = byCorr.get(c)
    if (!g) byCorr.set(c, (g = { handbacks: [] }))
    if (e.ev.type === "dispatch" && !g.dispatch) g.dispatch = e
    if (e.ev.type === "handback") g.handbacks.push(e)
    if (!g.childSessionID && typeof e.ev.childSessionID === "string" && e.ev.childSessionID) g.childSessionID = e.ev.childSessionID
  }
  return { byCorr, idles, entries, replies: new Map() }
}

/** @param {unknown} s @returns {"ok" | "error" | "interrupted" | "unknown"} */
const handbackStatus = (s) => (s === "ok" || s === "error" || s === "interrupted" ? s : "unknown")

/**
 * Delivery status of a dispatch: pending until a handback with the same correlationId arrives. If the dispatcher
 * itself went idle (SubagentStop/Stop) after the dispatch with no handback, the outcome can no longer be known.
 * @param {Entry} entry @param {EntryIndex} index @returns {"pending" | "ok" | "error" | "interrupted" | "unknown"}
 */
export function deliveryStatus(entry, index) {
  const c = entry.ev.correlationId
  if (typeof c !== "string" || !c) return "unknown"
  const hb = index.byCorr.get(c)?.handbacks
  if (hb && hb.length) return handbackStatus(hb[hb.length - 1].ev.status)
  const idles = index.idles.get(idleKey(entry.ev.sessionID, entry.sender))
  return idles && idles.some((i) => compareEntries(i, entry) > 0) ? "unknown" : "pending"
}

/**
 * "N replies" of a dispatch row: exactly the thread panel's set (linkedEvents, incl. OpenCode child-session events).
 * Memoized per index (an index is rebuilt whenever entries change).
 * @param {Entry} entry @param {EntryIndex} index
 */
export function replyCount(entry, index) {
  if (entry.ev.type !== "dispatch") return 0
  let n = index.replies.get(entry.key)
  if (n === undefined) index.replies.set(entry.key, (n = linkedEvents(entry, index.entries, index).length))
  return n
}

/** Thread root: the dispatch of the entry's task when known, else the entry itself. @param {Entry} entry @param {EntryIndex} index */
export function threadRootOf(entry, index) {
  const c = entry.ev.correlationId
  return (typeof c === "string" && c && index.byCorr.get(c)?.dispatch) || entry
}

/**
 * Unread message counts per agent channel: prompt/dispatch/handback/error events involving the agent that arrived
 * at or after max(baseline, seen[agent]). Before the first hello (baseline null) nothing is unread.
 * @param {Entry[]} entries @param {number | null} baseline @param {Record<string, number>} seen @returns {Map<string, number>}
 */
export function unreadCounts(entries, baseline, seen) {
  /** @type {Map<string, number>} */
  const out = new Map()
  if (baseline === null) return out
  for (const e of entries) {
    if (e.kind !== "prompt" && e.kind !== "dispatch" && e.kind !== "handback" && e.kind !== "error") continue
    for (const id of new Set([e.sender, e.receiver])) {
      if (!id || id === USER || id === "unknown") continue
      if (e.seq >= Math.max(baseline, seen[id] ?? 0)) out.set(id, (out.get(id) ?? 0) + 1)
    }
  }
  return out
}

/** Status shown on a timeline row ("" = none). @param {Entry} entry @param {EntryIndex} index @returns {string} */
export function rowStatus(entry, index) {
  switch (entry.ev.type) {
    case "dispatch":
      return deliveryStatus(entry, index)
    case "handback":
      return handbackStatus(entry.ev.status)
    case "error":
      return "error"
    default:
      return ""
  }
}

/** @param {unknown} v */
const okDuration = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0

/**
 * Producer durationMs, else handback.ts - dispatch.ts for the same correlationId (both valid, >= 0), else undefined.
 * For a dispatch, the duration of its latest handback.
 * @param {Entry} entry @param {EntryIndex} index @returns {number | undefined}
 */
export function durationOf(entry, index) {
  const c = entry.ev.correlationId
  /** @type {Entry | undefined} */
  let hb
  if (entry.ev.type === "handback") hb = entry
  else if (entry.ev.type === "dispatch" && typeof c === "string" && c) {
    const list = index.byCorr.get(c)?.handbacks
    hb = list?.[list.length - 1]
  }
  // Only a final handback ends a task (a background launch reports status unknown).
  if (!hb || handbackStatus(hb.ev.status) === "unknown") return undefined
  if (okDuration(hb.ev.durationMs)) return /** @type {number} */ (hb.ev.durationMs)
  const hc = hb.ev.correlationId
  const d = typeof hc === "string" && hc ? index.byCorr.get(hc)?.dispatch : undefined
  if (!d || !d.tsValid || !hb.tsValid) return undefined
  const diff = /** @type {number} */ (hb.ev.ts) - /** @type {number} */ (d.ev.ts)
  return diff >= 0 ? diff : undefined
}

/**
 * @typedef {{ id: string, status: "working" | "done" | "error" | "unknown", toolErrors: number, messages: number,
 *   lastTask?: string, lastTs?: number, lastSeq: number, requested: string[] }} AgentSummary
 */

/**
 * Per-agent summaries. Task status is lifecycle-driven only:
 * prompt/busy/dispatch-received -> working; idle after working -> done; handback ok -> done;
 * handback error, or error WITHOUT toolName -> error; otherwise unknown. Tool errors only count toward `toolErrors`.
 * @param {Entry[]} entries @returns {Map<string, AgentSummary>}
 */
export function agentSummaries(entries) {
  /** @type {Map<string, AgentSummary>} */
  const out = new Map()
  /** @param {string} id @returns {AgentSummary} */
  const get = (id) => {
    let s = out.get(id)
    if (!s) out.set(id, (s = { id, status: "unknown", toolErrors: 0, messages: 0, lastSeq: -1, requested: [] }))
    return s
  }
  /** @param {AgentSummary} s */
  const startWork = (s) => {
    if (s.status !== "working") s.toolErrors = 0 // a new task starts with a clean tool-error badge
    s.status = "working"
  }
  for (const e of entries) {
    const ev = e.ev
    const ids = [e.sender, e.receiver].filter((x) => x && x !== USER && x !== "unknown")
    for (const id of /** @type {string[]} */ (ids)) {
      const s = get(id)
      s.lastSeq = Math.max(s.lastSeq, e.seq)
      if (e.tsValid) s.lastTs = Math.max(s.lastTs ?? 0, /** @type {number} */ (ev.ts))
      if (e.kind === "prompt" || e.kind === "dispatch" || e.kind === "handback") s.messages++
    }
    const self = e.ev.type === "prompt" ? e.receiver : e.sender
    if (!self || self === "unknown") continue
    const s = get(self)
    switch (ev.type) {
      case "prompt":
        startWork(s)
        if (ev.text) s.lastTask = ev.text
        break
      case "busy":
        startWork(s)
        if (ev.text) s.lastTask = ev.text
        break
      case "dispatch": {
        if (!e.receiver || e.receiver === "unknown") break
        const r = get(e.receiver)
        startWork(r)
        if (ev.text) r.lastTask = ev.text
        if (ev.requestedAgent && !r.requested.includes(ev.requestedAgent)) r.requested.push(ev.requestedAgent)
        break
      }
      case "idle":
        if (s.status === "working") s.status = "done"
        break
      case "handback":
        if (ev.status === "ok") s.status = "done"
        else if (ev.status === "error") s.status = "error"
        if (ev.requestedAgent && !s.requested.includes(ev.requestedAgent)) s.requested.push(ev.requestedAgent)
        break
      case "error":
        if (isToolError(ev)) s.toolErrors++
        else s.status = "error"
        break
    }
  }
  return out
}

/**
 * @typedef {{ agent?: string | null, sender?: string, receiver?: string, correlationId?: string, kinds?: string[],
 *   status?: string, sinceMs?: number, search?: string }} ChatFilter
 */

const SEARCH_FIELDS = ["text", "prompt", "result", "error", "agent", "target", "requestedAgent", "sessionID", "childSessionID", "correlationId", "eventId", "toolName"]

/** Search runs over the stored (already masked) values, so a secret can't be probed for. @param {Entry} e @param {string} q lower-cased query */
export function matchesSearch(e, q) {
  if (!q) return true
  for (const f of SEARCH_FIELDS) {
    const v = e.ev[f]
    if (typeof v === "string" && v.toLowerCase().includes(q)) return true
  }
  return false
}

/** Child session of a correlation (OpenCode), used to isolate a task. @param {string} c @param {EntryIndex} index */
const childOf = (c, index) => index.byCorr.get(c)?.childSessionID

/**
 * @param {Entry[]} entries @param {ChatFilter} f @param {EntryIndex} index @param {number} now
 * @returns {Entry[]}
 */
export function filterEntries(entries, f, index, now) {
  const q = (f.search ?? "").trim().toLowerCase()
  const kinds = f.kinds ? new Set(f.kinds) : null
  const child = f.correlationId ? childOf(f.correlationId, index) : undefined
  return entries.filter((e) => {
    const ev = e.ev
    if (f.agent && e.sender !== f.agent && e.receiver !== f.agent) return false
    if (f.sender && e.sender !== f.sender) return false
    if (f.receiver && e.receiver !== f.receiver) return false
    if (f.correlationId && ev.correlationId !== f.correlationId && !(child && (ev.sessionID === child || ev.childSessionID === child))) return false
    if (kinds && !kinds.has(e.kind)) return false
    if (f.status && rowStatus(e, index) !== f.status) return false
    if (f.sinceMs !== undefined && f.sinceMs > 0 && !(e.tsValid && /** @type {number} */ (ev.ts) >= now - f.sinceMs)) return false
    return matchesSearch(e, q)
  })
}

/**
 * Events linked to `entry`: same correlationId, and (OpenCode) events of its child session.
 * @param {Entry} entry @param {Entry[]} entries @param {EntryIndex} index @returns {Entry[]}
 */
export function linkedEvents(entry, entries, index) {
  const c = typeof entry.ev.correlationId === "string" && entry.ev.correlationId ? entry.ev.correlationId : undefined
  const child = (typeof entry.ev.childSessionID === "string" && entry.ev.childSessionID) || (c ? childOf(c, index) : undefined)
  if (!c && !child) return []
  return entries.filter(
    (e) => e !== entry && ((c && e.ev.correlationId === c) || (child && (e.ev.sessionID === child || e.ev.childSessionID === child))),
  )
}

/** "claude:…ABCD1234" @param {unknown} c */
export function shortCorr(c) {
  if (typeof c !== "string" || !c) return ""
  const i = c.indexOf(":")
  const [prefix, id] = i >= 0 ? [c.slice(0, i), c.slice(i + 1)] : ["", c]
  const tail = id.length > 8 ? `…${id.slice(-8)}` : id
  return prefix ? `${prefix}:${tail}` : tail
}

/** @param {number | undefined} ms */
export function fmtDuration(ms) {
  if (ms === undefined) return ""
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${Math.round(s % 60)}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/** One-line summary of an event for the timeline. @param {ChatEvent} ev */
export function summaryOf(ev) {
  if (ev.type === "handback") {
    if (ev.status === "error") return ev.error || ev.text || "failed"
    return ev.result || ev.text || (ev.status === "ok" ? "done" : `status ${ev.status ?? "unknown"}`)
  }
  if (ev.type === "error") return ev.text || ev.error || "error"
  if (ev.type.startsWith("lock.")) return `${ev.type.slice(5)} ${ev.feature ?? ""}`.trim()
  if (ev.type === "idle") return ev.text || "idle"
  if (ev.type === "busy") return ev.text || "busy"
  return ev.text || ev.prompt || ""
}
