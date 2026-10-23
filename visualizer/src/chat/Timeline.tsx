import { Fragment, useLayoutEffect, useRef, useState } from "react"
import type { Connection } from "../useOfficeStream"
import { Avatar, agentColor, statusLabel } from "./avatar"
import type { ChatFilterState } from "./ChatView"
import {
  ALL_KINDS,
  badgeOf,
  DEFAULT_KINDS,
  dayLabel,
  durationOf,
  fmtDuration,
  groupByDay,
  isSystemEntry,
  replyCount,
  replyQuote,
  rowStatus,
  shortCorr,
  sideOf,
  summaryOf,
  type AgentSummary,
  type Entry,
  type EntryIndex,
  type Room,
} from "./model.mjs"

type Props = {
  all: Entry[]
  filtered: Entry[]
  index: EntryIndex
  filter: ChatFilterState
  onFilter: (p: Partial<ChatFilterState>) => void
  onClear: () => void
  senders: string[]
  receivers: string[]
  selectedKey: string | null
  onSelect: (key: string) => void
  limit: number
  onShowMore: () => void
  connection: Connection
  demo: boolean
  room: Room | undefined
  summaries: Map<string, AgentSummary>
  onBack: () => void
  filterOpen: boolean
  onToggleFilter: () => void
  now: number
  parseErrors: number
  historyDropped: boolean
}

const RANGES: [label: string, ms: number][] = [
  ["All time", 0],
  ["Last 5 min", 5 * 60_000],
  ["Last 15 min", 15 * 60_000],
  ["Last hour", 3_600_000],
  ["Last 24 h", 86_400_000],
]
const STATUSES = ["pending", "ok", "error", "interrupted", "unknown"]
/** Within this distance of the bottom the feed counts as "at latest" and keeps following new rows. */
const STICK_PX = 40
/** Bubbles longer than this are clamped behind "Read more". */
const LONG_CHARS = 280
const LONG_LINES = 6

/** WhatsApp-style ticks, driven by the real delivery status only. */
const TICK: Record<string, string> = { pending: "✓", ok: "✓✓", error: "✕ error", interrupted: "⏸ interrupted", unknown: "? unknown" }

export const clock = (ts: number) => new Date(ts).toLocaleTimeString("en-GB", { hour12: false })
const hhmm = (ts: number) => new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })

const sameKinds = (a: string[]) => a.length === DEFAULT_KINDS.length && DEFAULT_KINDS.every((k) => a.includes(k))
const activeFilters = (f: ChatFilterState) =>
  [f.sender, f.receiver, f.correlationId, f.status, f.sinceMs, f.search.trim()].filter(Boolean).length + (sameKinds(f.kinds) ? 0 : 1)

function StatusText({ id, summaries }: { id: string; summaries: Map<string, AgentSummary> }) {
  const s = summaries.get(id)?.status
  return (
    <span className="chat-side-status">
      <b style={{ color: agentColor(id) }}>{id}</b> <span className={`status ${s ?? "unknown"}`}>● {statusLabel(s)}</span>
    </span>
  )
}

/** Room pane: compact header (+ filter menu) and the bubble feed (latest `limit` matches, newest at the bottom). */
export function Timeline(p: Props) {
  const { filter, onFilter, room } = p
  const visible = p.filtered.slice(-p.limit)
  const hidden = p.filtered.length - visible.length
  const lastKey = visible[visible.length - 1]?.key
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  // Auto-scroll to the newest row unless the user scrolled up; then offer a "jump to latest" pill.
  const box = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)
  const [awayKey, setAwayKey] = useState<string | undefined>(undefined)
  useLayoutEffect(() => {
    if (stick && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lastKey, stick, room?.id, filter])
  // New filters/room = a new feed: follow the latest again (otherwise the "jump" pill could stick).
  useLayoutEffect(() => {
    setStick(true)
    setAwayKey(undefined)
  }, [filter, room?.id])
  const onScroll = () => {
    const el = box.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
    if (atBottom !== stick) {
      setStick(atBottom)
      setAwayKey(atBottom ? undefined : lastKey)
    }
  }
  const jump = () => {
    setStick(true)
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }
  const scrollTo = (key: string) => {
    box.current?.querySelector(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" })
  }
  const toggleKind = (k: string) =>
    onFilter({ kinds: filter.kinds.includes(k) ? filter.kinds.filter((x) => x !== k) : [...filter.kinds, k] })
  const nFilters = activeFilters(filter)

  const bubble = (e: Entry, first: boolean) => {
    const side = sideOf(e, room)
    const status = rowStatus(e, p.index)
    const dur = fmtDuration(durationOf(e, p.index))
    const badge = badgeOf(e.ev)
    const corr = e.ev.correlationId
    const replies = replyCount(e, p.index)
    const quote = replyQuote(e, p.index)
    const text = summaryOf(e.ev) || "(no text)"
    const long = text.length > LONG_CHARS || text.split("\n").length > LONG_LINES
    const open = expanded.has(e.key)
    const select = () => p.onSelect(e.key)
    return (
      <div key={e.key} className={`chat-brow ${side}`} data-key={e.key}>
        <div
          className={`chat-bubble ${side} ${badge === "error" ? "error" : ""} ${p.selectedKey === e.key ? "selected" : ""}`}
          role="button"
          tabIndex={0}
          onClick={select}
          onKeyDown={(k) => {
            if (k.target === k.currentTarget && (k.key === "Enter" || k.key === " ")) {
              k.preventDefault()
              select()
            }
          }}
        >
          {first && (
            <div className="chat-bubble-name" style={{ color: agentColor(e.sender) }}>
              {e.sender}
              {(!room || room.type !== "pair") && e.receiver && <span className="muted"> → {e.receiver}</span>}
            </div>
          )}
          {quote && (
            <button
              className="chat-quote"
              style={{ borderLeftColor: agentColor(quote.sender) }}
              title="Show the original dispatch"
              onClick={(ev) => {
                ev.stopPropagation()
                p.onSelect(quote.key)
                scrollTo(quote.key)
              }}
            >
              <b style={{ color: agentColor(quote.sender) }}>{quote.sender}</b>
              <span>{summaryOf(quote.ev) || "dispatch"}</span>
            </button>
          )}
          <div className={`chat-bubble-text ${long && !open ? "clamped" : ""}`}>{text}</div>
          {long && (
            <button
              className="chat-readmore"
              onClick={(ev) => {
                ev.stopPropagation()
                setExpanded((s) => {
                  const n = new Set(s)
                  if (n.has(e.key)) n.delete(e.key)
                  else n.add(e.key)
                  return n
                })
              }}
            >
              {open ? "Show less" : "Read more"}
            </button>
          )}
          <div className="chat-bubble-meta">
            <span className={`chat-badge ${badge}`}>{e.ev.type}</span>
            {corr && (
              <button
                className="chat-corr mono"
                title={`Isolate task ${corr}`}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onFilter({ correlationId: corr })
                }}
              >
                {shortCorr(corr)}
              </button>
            )}
            {replies > 0 && (
              <button
                className="chat-replies"
                title="Open thread"
                onClick={(ev) => {
                  ev.stopPropagation()
                  select()
                }}
              >
                {replies} {replies === 1 ? "reply" : "replies"}
              </button>
            )}
            {dur && <span className="mono muted">{dur}</span>}
            <span className="chat-bubble-time mono muted">
              {e.tsValid ? hhmm(e.ev.ts as number) : "—"}
              {!e.tsValid && (
                <span className="chat-chip warn" title="invalid timestamp, ordered by arrival">
                  ts?
                </span>
              )}
            </span>
            {status && (
              <span className={`chat-tick chat-status ${status}`} title={`status: ${status}`} aria-label={`status: ${status}`}>
                {TICK[status] ?? status}
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }

  const pill = (e: Entry) => (
    <div key={e.key} className="chat-pill-row" data-key={e.key}>
      <button className={`chat-pill ${badgeOf(e.ev)} ${p.selectedKey === e.key ? "selected" : ""}`} onClick={() => p.onSelect(e.key)}>
        <b style={{ color: agentColor(e.sender) }}>{e.sender}</b> {summaryOf(e.ev) || e.ev.type}
        <span className="mono muted"> · {e.tsValid ? hhmm(e.ev.ts as number) : "—"}</span>
      </button>
    </div>
  )

  return (
    <section className="card chat-col chat-timeline" aria-label="Messages">
      <div className="chat-roomhead">
        <button className="chat-back" onClick={p.onBack} aria-label="Back to rooms">
          ←
        </button>
        {room?.type === "pair" ? (
          <>
            <Avatar id={room.initiator ?? room.members[0]} small />
            <Avatar id={room.counterpart} small status={p.summaries.get(room.counterpart)?.status ?? "unknown"} />
          </>
        ) : (
          <Avatar id={room?.members[0] ?? "user"} label={room ? undefined : "All"} small status={room ? (p.summaries.get(room.members[0])?.status ?? "unknown") : undefined} />
        )}
        <div className="chat-roomhead-body">
          <b className="chat-roomhead-title">{room ? room.name : "All"}</b>
          <span className="chat-roomhead-sub muted">
            {room?.type === "pair" ? (
              <>
                <StatusText id={room.initiator ?? room.members[0]} summaries={p.summaries} />
                {" · "}
                <StatusText id={room.counterpart} summaries={p.summaries} />
              </>
            ) : room ? (
              <StatusText id={room.members[0]} summaries={p.summaries} />
            ) : (
              `${p.all.length} events · every agent`
            )}
          </span>
        </div>
        <span className="chat-roomstatus" title={`bridge ${p.connection}`}>
          <span className={`dot ${p.connection}`} />
          {p.parseErrors > 0 && <span className="chat-chip error">{p.parseErrors} parse errors</span>}
          {p.historyDropped && <span className="chat-chip">older history dropped</span>}
        </span>
        {filter.correlationId && (
          <span className="chat-chip">
            task <span className="mono">{shortCorr(filter.correlationId)}</span>
            <button className="chat-x" onClick={() => onFilter({ correlationId: "" })} aria-label="Clear task filter">
              ×
            </button>
          </span>
        )}
        <button className={`chat-filterbtn ${nFilters > 0 ? "on" : ""}`} onClick={p.onToggleFilter} aria-expanded={p.filterOpen} aria-label="Filters">
          ⚙ Filter{nFilters > 0 ? ` (${nFilters})` : ""}
        </button>
      </div>

      {p.filterOpen && (
        <div className="chat-filters" role="group" aria-label="Filters">
          <input
            className="chat-search"
            type="search"
            placeholder="Search text, prompt, result, agent, ids…"
            value={filter.search}
            onChange={(e) => onFilter({ search: e.target.value })}
          />
          <select aria-label="Sender" value={filter.sender} onChange={(e) => onFilter({ sender: e.target.value })}>
            <option value="">Any sender</option>
            {p.senders.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select aria-label="Receiver" value={filter.receiver} onChange={(e) => onFilter({ receiver: e.target.value })}>
            <option value="">Any receiver</option>
            {p.receivers.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select aria-label="Status" value={filter.status} onChange={(e) => onFilter({ status: e.target.value })}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select aria-label="Time range" value={filter.sinceMs} onChange={(e) => onFilter({ sinceMs: Number(e.target.value) })}>
            {RANGES.map(([label, ms]) => (
              <option key={ms} value={ms}>
                {label}
              </option>
            ))}
          </select>
          <div className="chat-kinds">
            {ALL_KINDS.map((k) => (
              <button key={k} className={`chat-kind ${filter.kinds.includes(k) ? "on" : ""}`} aria-pressed={filter.kinds.includes(k)} onClick={() => toggleKind(k)}>
                {k}
              </button>
            ))}
          </div>
          <button className="demo-btn" onClick={p.onClear}>
            Reset filters
          </button>
        </div>
      )}

      {!stick && (
        <button className="chat-jump" onClick={jump}>
          {lastKey !== awayKey ? "New messages · " : ""}Jump to latest ↓
        </button>
      )}
      <div className="chat-rows" ref={box} onScroll={onScroll}>
        {p.all.length === 0 ? (
          <div className="chat-empty muted">
            {p.connection === "connecting"
              ? "Connecting to the bridge…"
              : p.connection === "live"
                ? "Connected. No agent interactions yet: send a prompt in Claude Code, OpenCode or Cline."
                : p.demo
                  ? "No real bridge events yet. Stop the demo to connect to the bridge."
                  : "Bridge offline. Start a tool session (the daemon auto-starts) and this view will fill in."}
          </div>
        ) : p.filtered.length === 0 ? (
          <div className="chat-empty muted">
            No events match the current filters{room ? ` in ${room.name}` : ""}.{" "}
            <button className="demo-btn" onClick={p.onClear}>
              Clear filters
            </button>
          </div>
        ) : (
          <>
            {hidden > 0 && (
              <button className="demo-btn chat-more" onClick={p.onShowMore}>
                Show more ({hidden} older)
              </button>
            )}
            {groupByDay(visible).map((g) => {
              let prev: Entry | undefined // previous bubble in this day; a system pill breaks the group
              return (
                <Fragment key={g.key}>
                  <div className="chat-day">
                    <span>{dayLabel(g.ts, p.now)}</span>
                  </div>
                  {g.entries.map((e) => {
                    if (isSystemEntry(e)) {
                      prev = undefined
                      return pill(e)
                    }
                    const first = !prev || prev.sender !== e.sender
                    prev = e
                    return bubble(e, first)
                  })}
                </Fragment>
              )
            })}
          </>
        )}
      </div>
    </section>
  )
}
