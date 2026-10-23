import type { KeyboardEvent } from "react"
import { Avatar } from "./avatar"
import { ALL_ROOM, dayKey, summaryOf, type AgentSummary, type Entry, type Room } from "./model.mjs"

type Props = {
  rooms: Room[]
  summaries: Map<string, AgentSummary>
  selected: string
  onSelect: (id: string) => void
  total: number
  lastAll: Entry | undefined
  now: number
}

const hhmm = (ts: number) => new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })

/** Time of the last message: clock today, short date otherwise. */
function shortTime(ts: number, now: number) {
  return dayKey(ts) === dayKey(now) ? hhmm(ts) : new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

const preview = (e: Entry) => `${e.sender}: ${summaryOf(e.ev) || e.ev.type}`

function Row(p: { id: string; avatarId: string; label?: string; status?: AgentSummary["status"]; title: string; last?: Entry; unread: number; selected: boolean; now: number; onSelect: () => void; fallback?: string }) {
  return (
    <button className={`chat-room ${p.selected ? "selected" : ""} ${p.unread > 0 ? "unread" : ""}`} data-room={p.id} aria-current={p.selected ? "true" : undefined} onClick={p.onSelect}>
      <Avatar id={p.avatarId} label={p.label} status={p.status} />
      <span className="chat-room-body">
        <span className="chat-room-head">
          <b className="chat-room-name">{p.title}</b>
          {p.last && <span className="chat-room-time muted mono">{shortTime(p.last.sortTs, p.now)}</span>}
        </span>
        <span className="chat-room-head">
          <span className="chat-room-preview muted">{p.last ? preview(p.last) : (p.fallback ?? "no activity")}</span>
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

/** Left pane: "All" plus one row per room, newest activity first. Up/Down move focus between rows. */
export function RoomList({ rooms, summaries, selected, onSelect, total, lastAll, now }: Props) {
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button.chat-room")]
    const i = rows.indexOf(document.activeElement as HTMLButtonElement)
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]
    if (next) {
      e.preventDefault()
      next.focus()
    }
  }
  return (
    <aside className="card chat-col chat-rooms" aria-label="Chat rooms" onKeyDown={onKeyDown}>
      <Row id={ALL_ROOM} avatarId="user" label="All" title="All" last={lastAll} unread={0} selected={selected === ALL_ROOM} now={now} onSelect={() => onSelect(ALL_ROOM)} fallback={`${total} events`} />
      {rooms.map((r) => (
        <Row
          key={r.id}
          id={r.id}
          avatarId={r.counterpart}
          status={summaries.get(r.counterpart)?.status ?? "unknown"}
          title={r.name}
          last={r.lastMsg}
          unread={r.unread}
          selected={selected === r.id}
          now={now}
          onSelect={() => onSelect(r.id)}
        />
      ))}
      {rooms.length === 0 && <div className="chat-empty muted">No rooms yet. Rooms appear when agents exchange messages.</div>}
    </aside>
  )
}
