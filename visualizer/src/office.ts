import { normalizeAgent, ORCHESTRATOR_ID } from "./agents"

/** Event shape sent by .opencode/plugins/office-bridge.ts */
export type OfficeEvent = {
  ts: number
  type:
    | "prompt"
    | "dispatch"
    | "handback"
    | "activity"
    | "busy"
    | "idle"
    | "error"
    | "lock.acquired"
    | "lock.waiting"
    | "lock.released"
    | "lock.expired"
    | "lock.override"
  agent: string
  sessionID: string
  target?: string
  text?: string
  /** Originating tool: opencode | claude | cline. */
  source?: string
  priority?: string
  phase?: string
  /** Lock events: the feature being locked. */
  feature?: string
  /** lock.expired: why (e.g. "stale" = the holder stopped sending events). */
  reason?: string
  /** lock.waiting: who currently holds the feature. */
  waitingOn?: { source: string; sessionID?: string; feature: string }
  /** Daemon-assigned `<boot>-<seq>` id (unique per daemon run). */
  eventId?: string
  /** Links a dispatch to its handback (claude:<tool_use_id> | opencode:<child session>). */
  correlationId?: string
  /** Raw subagent name when the bridge relabelled it (e.g. unknown type -> "scout"). */
  requestedAgent?: string
  /** Full (masked, clipped) prompt / handback result / error. */
  prompt?: string
  result?: string
  error?: string
  /** handback: ok | error | interrupted. */
  status?: string
  durationMs?: number
  /** Set on tool failures (as opposed to agent/task failures). */
  toolName?: string
  /** OpenCode: the child session a dispatch created. */
  childSessionID?: string
}

export type AgentStatus = "idle" | "working" | "done" | "error"

export type AgentState = {
  status: AgentStatus
  task?: string
  activity?: string
  source?: string
  /** Set while the agent is blocked on another tool's feature lock. */
  waitingOn?: { source: string; sessionID?: string; feature: string }
  /** Set when the lock circuit breaker let this agent through despite a held lock. */
  warning?: string
  updated: number
  calls: number
}

export type LogEntry = { ts: number; agent: string; kind: OfficeEvent["type"]; text: string }

export type OfficeState = {
  agents: Record<string, AgentState>
  log: LogEntry[]
  orchestratorTarget: string | null
  dispatched: number
  completed: number
  /** Dispatched-but-unfinished tasks per agent; completions only count against these. */
  pending: Record<string, number>
  /** Currently held feature locks (from lock.* events). */
  locks: Record<string, { source: string; agent: string; since: number }>
  startedAt?: number
}

export const initialState: OfficeState = { agents: {}, log: [], orchestratorTarget: null, dispatched: 0, completed: 0, pending: {}, locks: {} }

export type Action = { type: "reset" } | { type: "event"; event: OfficeEvent }

const LOG_LIMIT = 150

function patch(state: OfficeState, id: string, ts: number, p: Partial<AgentState>): OfficeState {
  const prev = state.agents[id] ?? { status: "idle", updated: 0, calls: 0 }
  return { ...state, agents: { ...state.agents, [id]: { ...prev, ...p, updated: ts } } }
}

function log(state: OfficeState, entry: LogEntry): OfficeState {
  const next = [...state.log, entry]
  return { ...state, log: next.length > LOG_LIMIT ? next.slice(-LOG_LIMIT) : next }
}

export function reducer(state: OfficeState, action: Action): OfficeState {
  if (action.type === "reset") return initialState
  const e = action.event
  const id = normalizeAgent(e.agent)
  if (!id) return state
  const s0 = state.startedAt ? state : { ...state, startedAt: e.ts }
  const current = s0.agents[id]
  // Any non-lock event from an agent means it is no longer blocked on a lock; lock.waiting/acquired set it below.
  const s =
    (current?.waitingOn || current?.warning) && !e.type.startsWith("lock.")
      ? patch(s0, id, current.updated, { waitingOn: undefined, warning: undefined })
      : s0

  switch (e.type) {
    case "prompt":
      return log(patch(s, id, e.ts, { status: "working", task: e.text, activity: "Membaca prompt" }), {
        ts: e.ts, agent: id, kind: e.type, text: `Prompt: ${e.text}`,
      })
    case "dispatch": {
      const target = normalizeAgent(e.target)
      if (!target) return s
      let next = patch(s, target, e.ts, { status: "working", task: e.text, activity: "Menerima tugas" })
      next = patch(next, id, e.ts, { status: "working", activity: `Delegasi ke ${target}` })
      next = {
        ...next,
        dispatched: next.dispatched + 1,
        pending: { ...next.pending, [target]: (next.pending[target] ?? 0) + 1 },
        orchestratorTarget: id === ORCHESTRATOR_ID ? target : next.orchestratorTarget,
      }
      return log(next, { ts: e.ts, agent: id, kind: e.type, text: `Delegasi ke ${target}: ${e.text ?? ""}` })
    }
    case "activity":
      return log(patch(s, id, e.ts, { status: "working", activity: e.text, calls: (current?.calls ?? 0) + 1 }), {
        ts: e.ts, agent: id, kind: e.type, text: e.text ?? "",
      })
    case "busy":
      return patch(s, id, e.ts, { status: "working", ...(e.text ? { task: e.text } : {}) })
    case "idle": {
      if (current?.status !== "working") return s
      let next = patch(s, id, e.ts, { status: "done", activity: undefined })
      if (id === ORCHESTRATOR_ID) next = { ...next, orchestratorTarget: null }
      else if ((next.pending[id] ?? 0) > 0) {
        // A session can go idle more than once per task (resume, late events): count each task once.
        next = { ...next, completed: next.completed + 1, pending: { ...next.pending, [id]: next.pending[id] - 1 } }
      }
      return log(next, { ts: e.ts, agent: id, kind: e.type, text: "Selesai" })
    }
    case "lock.waiting": {
      const feature = e.waitingOn?.feature ?? e.feature ?? "?"
      const holder = e.waitingOn?.source ?? "?"
      const text = `Menunggu ${feature} (${holder})`
      return log(patch(s, id, e.ts, { status: "working", activity: text, source: e.source, waitingOn: e.waitingOn ?? { source: holder, feature } }), {
        ts: e.ts, agent: id, kind: e.type, text,
      })
    }
    case "lock.acquired": {
      const feature = e.feature ?? "?"
      const next = patch(s, id, e.ts, { source: e.source, waitingOn: undefined })
      return log({ ...next, locks: { ...next.locks, [feature]: { source: e.source ?? "?", agent: id, since: e.ts } } }, {
        ts: e.ts, agent: id, kind: e.type, text: `Mengunci ${feature}`,
      })
    }
    case "lock.override": {
      const feature = e.feature ?? "?"
      const holder = e.waitingOn?.source ?? "?"
      const text = `Peringatan: ${feature} dikunci ${holder}, diizinkan setelah beberapa penolakan`
      return log(patch(s, id, e.ts, { status: "working", source: e.source, waitingOn: undefined, warning: text }), { ts: e.ts, agent: id, kind: e.type, text })
    }
    case "lock.released":
    case "lock.expired": {
      const feature = e.feature ?? "?"
      const { [feature]: _gone, ...rest } = s.locks
      const label = e.type === "lock.released" ? "Melepas" : e.reason === "stale" ? "Kunci yatim (pemilik berhenti), diambil alih" : "Kunci kedaluwarsa"
      return log({ ...s, locks: rest }, { ts: e.ts, agent: id, kind: e.type, text: `${label} ${feature}` })
    }
    case "error":
      return log(patch(s, id, e.ts, { status: "error", activity: e.text }), {
        ts: e.ts, agent: id, kind: e.type, text: `Error: ${e.text ?? ""}`,
      })
    default:
      // New/unknown event types (e.g. handback) are for other views; the Workflow view ignores them.
      return state
  }
}
