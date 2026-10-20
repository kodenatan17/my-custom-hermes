import { useLayoutEffect, useRef, useState } from "react"
import type { Connection } from "../useOfficeStream"
import type { ChatFilterState } from "./ChatView"
import {
  ALL_KINDS,
  badgeOf,
  durationOf,
  fmtDuration,
  replyCount,
  rowStatus,
  shortCorr,
  summaryOf,
  type Entry,
  type EntryIndex,
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
  agentFilter: string | null
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

export const clock = (ts: number) => new Date(ts).toLocaleTimeString("en-GB", { hour12: false })

/** Middle column: filters + the message feed (latest `limit` matches, grouped by sender, newest at the bottom). */
export function Timeline(p: Props) {
  const { filter, onFilter } = p
  const visible = p.filtered.slice(-p.limit)
  const hidden = p.filtered.length - visible.length
  const lastKey = visible[visible.length - 1]?.key

  // Auto-scroll to the newest row unless the user scrolled up; then offer a "jump to latest" pill.
  const box = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)
  const [awayKey, setAwayKey] = useState<string | undefined>(undefined)
  useLayoutEffect(() => {
    if (stick && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lastKey, stick])
  // New filters/channel = a new feed: follow the latest again (otherwise the "jump" pill could stick).
  useLayoutEffect(() => {
    setStick(true)
    setAwayKey(undefined)
  }, [filter, p.agentFilter])
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
  const toggleKind = (k: string) =>
    onFilter({ kinds: filter.kinds.includes(k) ? filter.kinds.filter((x) => x !== k) : [...filter.kinds, k] })

  return (
    <section className="card chat-col chat-timeline">
      <div className="chat-filters">
        <input
          className="chat-search"
          placeholder="Search text, prompt, result, agent, ids…"
          value={filter.search}
          onChange={(e) => onFilter({ search: e.target.value })}
        />
        <select value={filter.sender} onChange={(e) => onFilter({ sender: e.target.value })}>
          <option value="">Any sender</option>
          {p.senders.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={filter.receiver} onChange={(e) => onFilter({ receiver: e.target.value })}>
          <option value="">Any receiver</option>
          {p.receivers.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={filter.status} onChange={(e) => onFilter({ status: e.target.value })}>
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={filter.sinceMs} onChange={(e) => onFilter({ sinceMs: Number(e.target.value) })}>
          {RANGES.map(([label, ms]) => (
            <option key={ms} value={ms}>
              {label}
            </option>
          ))}
        </select>
        <div className="chat-kinds">
          {ALL_KINDS.map((k) => (
            <button key={k} className={`chat-kind ${filter.kinds.includes(k) ? "on" : ""}`} onClick={() => toggleKind(k)}>
              {k}
            </button>
          ))}
        </div>
        {filter.correlationId && (
          <span className="chat-chip">
            task <span className="mono">{shortCorr(filter.correlationId)}</span>
            <button className="chat-x" onClick={() => onFilter({ correlationId: "" })} aria-label="Clear task filter">
              ×
            </button>
          </span>
        )}
      </div>

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
            No events match the current filters{p.agentFilter ? ` for ${p.agentFilter}` : ""}.{" "}
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
            {visible.map((e, i) => {
              const status = rowStatus(e, p.index)
              const dur = durationOf(e, p.index)
              const badge = badgeOf(e.ev)
              const corr = e.ev.correlationId
              const replies = replyCount(e, p.index)
              // Consecutive rows from the same sender share one header (message-feed style).
              const continued = i > 0 && visible[i - 1].sender === e.sender
              return (
                <div key={e.key} className="chat-msg">
                  {!continued && (
                    <div className="chat-msg-head">
                      <b>{e.sender === "user" ? "user" : `# ${e.sender}`}</b>
                      <span className="mono muted">{e.tsValid ? clock(e.ev.ts as number) : "—"}</span>
                    </div>
                  )}
                  <div
                    className={`chat-row ${p.selectedKey === e.key ? "selected" : ""}`}
                    onClick={() => p.onSelect(e.key)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(k) => k.key === "Enter" && p.onSelect(e.key)}
                  >
                    <span className="mono muted">
                      {e.tsValid ? clock(e.ev.ts as number) : "—"}
                      {!e.tsValid && (
                        <span className="chat-chip warn" title="invalid timestamp, ordered by arrival">
                          ts?
                        </span>
                      )}
                    </span>
                    <span className="chat-route">{e.receiver ? `→ ${e.receiver}` : ""}</span>
                    <span className={`chat-badge ${badge}`}>{e.ev.type}</span>
                    <span className="chat-summary">{summaryOf(e.ev)}</span>
                    {corr ? (
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
                    ) : (
                      <span />
                    )}
                    {replies > 0 ? (
                      <button
                        className="chat-replies"
                        title="Open thread"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          p.onSelect(e.key)
                        }}
                      >
                        {replies} {replies === 1 ? "reply" : "replies"}
                      </button>
                    ) : (
                      <span />
                    )}
                    <span className={status ? `chat-status ${status}` : ""}>{status}</span>
                    <span className="mono muted">{fmtDuration(dur)}</span>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </section>
  )
}
