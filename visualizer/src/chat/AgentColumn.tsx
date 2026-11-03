import type { KeyboardEvent, ReactNode } from "react"
import { Avatar } from "./avatar"
import { dayKey, summaryOf, type AgentEntry, type AgentSummary, type Entry } from "./model.mjs"

const hhmm = (ts: number) => new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })

/** Time of the last message: clock today, short date otherwise. */
export function shortTime(ts: number, now: number) {
  return dayKey(ts) === dayKey(now) ? hhmm(ts) : new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

/** Up/Down move focus between the list's rows. */
export function onArrowKeys(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
  const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button.chat-room")]
  const i = rows.indexOf(document.activeElement as HTMLButtonElement)
  const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]
  if (next) {
    e.preventDefault()
    next.focus()
  }
}

/** One selectable list row (same look as the old room list). */
export function NavRow(p: { id: string; avatarId: string; status?: AgentSummary["status"]; title: string; preview: string; last?: Entry; unread: number; selected: boolean; now: number; onSelect: () => void }) {
  return (
    <button className={`chat-room ${p.selected ? "selected" : ""} ${p.unread > 0 ? "unread" : ""}`} data-room={p.id} aria-current={p.selected ? "true" : undefined} title={p.title} onClick={p.onSelect}>
      <Avatar id={p.avatarId} status={p.status} />
      <span className="chat-room-body">
        <span className="chat-room-head">
          <b className="chat-room-name">{p.title}</b>
          {p.last && <span className="chat-room-time muted mono">{shortTime(p.last.sortTs, p.now)}</span>}
        </span>
        <span className="chat-room-head">
          <span className="chat-room-preview muted">{p.preview}</span>
          {p.unread > 0 && (
            <span className="chat-unread" title={`${p.unread} unread`}>
              {p.unread > 99 ? "99+" : p.unread}
            </span>
          )}
        </span>
      </span>
    </button>
  )
}

/** Column heading of a navigation list (optional back button for the one-pane layout). */
export function NavHead({ title, onBack, children }: { title: string; onBack?: () => void; children?: ReactNode }) {
  return (
    <div className="chat-navhead">
      {onBack && (
        <button className="chat-back" onClick={onBack} aria-label="Back">
          ←
        </button>
      )}
      <b className="chat-navhead-title">{title}</b>
      {children}
    </div>
  )
}

type Props = {
  agents: AgentEntry[]
  summaries: Map<string, AgentSummary>
  selected: string | undefined
  onSelect: (id: string) => void
  now: number
}

/** Column 1: every agent that exchanged messages with another agent, orchestrator first. */
export function AgentList({ agents, summaries, selected, onSelect, now }: Props) {
  return (
    <aside className="card chat-col chat-rooms chat-agents" aria-label="Agents" onKeyDown={onArrowKeys}>
      <NavHead title="Agents" />
      {agents.map((a) => (
        <NavRow
          key={a.id}
          id={a.id}
          avatarId={a.id}
          status={summaries.get(a.id)?.status ?? "unknown"}
          title={a.id}
          preview={`${a.partners} conversation${a.partners === 1 ? "" : "s"} · ${summaryOf(a.last.ev) || a.last.ev.type}`}
          last={a.last}
          unread={a.unread}
          selected={selected === a.id}
          now={now}
          onSelect={() => onSelect(a.id)}
        />
      ))}
      {agents.length === 0 && <div className="chat-empty muted">No agents yet. Agents appear when they exchange messages.</div>}
    </aside>
  )
}
