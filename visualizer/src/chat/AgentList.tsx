import { AGENT_BY_ID, CATEGORY_STYLE } from "../agents"
import { PINNED_AGENTS, type AgentSummary } from "./model.mjs"

type Props = {
  summaries: Map<string, AgentSummary>
  selected: string | null
  onSelect: (id: string | null) => void
  /** Unread message count per agent channel. */
  unread: Map<string, number>
  total: number
}

const TASK_LABEL: Record<AgentSummary["status"], string> = { working: "working", done: "done", error: "error", unknown: "unknown" }

const clock = (ts: number) => new Date(ts).toLocaleTimeString("en-GB", { hour12: false })

function AgentRow({ id, s, selected, unread, onSelect }: { id: string; s?: AgentSummary; selected: boolean; unread: number; onSelect: () => void }) {
  const agent = AGENT_BY_ID.get(id)
  const color = CATEGORY_STYLE[agent?.category ?? "other"].color
  return (
    <button className={`chat-agent ${selected ? "selected" : ""} ${unread > 0 ? "unread" : ""}`} onClick={onSelect}>
      <span className="chat-avatar" style={{ background: color }}>
        {(agent?.name ?? id).charAt(0).toUpperCase()}
      </span>
      <span className="chat-agent-body">
        <span className="chat-agent-head">
          <b className="chat-channel"># {id}</b>
          {agent && <span className="muted chat-agent-name">{agent.name}</span>}
          {unread > 0 && (
            <span className="chat-unread" title={`${unread} unread`}>
              {unread > 99 ? "99+" : unread}
            </span>
          )}
          {s && <span className={`status ${s.status}`}>● {TASK_LABEL[s.status]}</span>}
        </span>
        {s ? (
          <>
            {s.requested.length > 0 && <span className="chat-agent-line muted">requested as: {s.requested.join(", ")}</span>}
            <span className="chat-agent-line">{s.lastTask ?? "—"}</span>
            <span className="chat-agent-line muted mono">
              {s.messages} msgs · {s.lastTs ? clock(s.lastTs) : "—"}
              {s.toolErrors > 0 && <span className="chat-badge tool"> {s.toolErrors} tool error{s.toolErrors > 1 ? "s" : ""}</span>}
            </span>
          </>
        ) : (
          <span className="chat-agent-line muted">no activity</span>
        )}
      </span>
    </button>
  )
}

/** Left column (channels): All Agents, pinned roster agents, then any other observed agent ids. */
export function AgentList({ summaries, selected, onSelect, unread, total }: Props) {
  const others = [...summaries.keys()].filter((id) => !PINNED_AGENTS.includes(id)).sort()
  return (
    <aside className="card chat-col chat-agents">
      <button className={`chat-agent all ${selected === null ? "selected" : ""}`} onClick={() => onSelect(null)}>
        <b>All Agents</b>
        <span className="muted mono">{total} events</span>
      </button>
      {PINNED_AGENTS.map((id) => (
        <AgentRow key={id} id={id} s={summaries.get(id)} selected={selected === id} unread={unread.get(id) ?? 0} onSelect={() => onSelect(id)} />
      ))}
      {others.length > 0 && <div className="chat-group muted">Other agents</div>}
      {others.map((id) => (
        <AgentRow key={id} id={id} s={summaries.get(id)} selected={selected === id} unread={unread.get(id) ?? 0} onSelect={() => onSelect(id)} />
      ))}
    </aside>
  )
}
