import { useEffect, useMemo, useState } from "react"
import type { Connection, UnreadState } from "../useOfficeStream"
import { AgentList } from "./AgentList"
import { DetailPanel } from "./DetailPanel"
import {
  agentSummaries,
  buildIndex,
  DEFAULT_KINDS,
  filterEntries,
  linkedEvents,
  threadRootOf,
  unreadCounts,
  USER,
  type InteractionState,
} from "./model.mjs"
import { Timeline } from "./Timeline"

export type ChatFilterState = {
  sender: string
  receiver: string
  correlationId: string
  kinds: string[]
  status: string
  sinceMs: number
  search: string
}

export const EMPTY_FILTER: ChatFilterState = { sender: "", receiver: "", correlationId: "", kinds: DEFAULT_KINDS, status: "", sinceMs: 0, search: "" }

const PAGE = 500
const TICK_MS = 30_000

type Props = {
  interactions: InteractionState
  connection: Connection
  demo: boolean
  unread: UnreadState
  onSeen: (agent: string, seq: number) => void
}

/** Agent Chat View (read-only monitoring): channels | message feed | thread. Owns filter, search and selection state. */
export function ChatView({ interactions, connection, demo, unread, onSeen }: Props) {
  const { entries } = interactions
  const [agent, setAgent] = useState<string | null>(null)
  const [filter, setFilter] = useState<ChatFilterState>(EMPTY_FILTER)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  // Time presets are relative to "now": refresh them even when no events arrive.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [])

  // Viewing a channel marks it read (also for events arriving while it is open).
  useEffect(() => {
    if (agent) onSeen(agent, interactions.seq)
  }, [agent, interactions.seq, onSeen])

  const index = useMemo(() => buildIndex(entries), [entries])
  const summaries = useMemo(() => agentSummaries(entries), [entries])
  const unreadByAgent = useMemo(() => unreadCounts(entries, unread.baseline, unread.seen), [entries, unread])
  const filtered = useMemo(
    () => filterEntries(entries, { ...filter, agent, sinceMs: filter.sinceMs || undefined }, index, now),
    [entries, filter, agent, index, now],
  )
  const selected = useMemo(() => entries.find((e) => e.key === selectedKey), [entries, selectedKey])
  const root = useMemo(() => (selected ? threadRootOf(selected, index) : undefined), [selected, index])
  const replies = useMemo(() => (root ? linkedEvents(root, entries, index) : []), [root, entries, index])

  const senders = useMemo(() => [...new Set(entries.map((e) => e.sender))].sort(), [entries])
  const receivers = useMemo(() => [...new Set(entries.map((e) => e.receiver).filter((r): r is string => !!r && r !== USER))].sort(), [entries])

  const update = (p: Partial<ChatFilterState>) => {
    setFilter((f) => ({ ...f, ...p }))
    setLimit(PAGE)
  }
  const clear = () => {
    setFilter(EMPTY_FILTER)
    setAgent(null)
    setLimit(PAGE)
  }

  return (
    <div className="chat">
      <header className="card chat-header">
        <h1>
          Agent Chat View <span className="muted">· Seedly · read-only</span>
        </h1>
        <span className={`dot ${connection}`} />
        <span className="muted">{connection === "demo" ? "demo (bridge paused)" : connection}</span>
        <span className="muted mono">{entries.length} events</span>
        {interactions.parseErrors > 0 && <span className="chat-chip error">{interactions.parseErrors} parse errors</span>}
        {interactions.historyDropped && <span className="chat-chip">older history dropped</span>}
      </header>

      {demo && (
        <div className="card chat-banner demo">
          Demo is playing in the Workflow View only. This view shows real bridge events ({entries.length} cached).
        </div>
      )}
      {!demo && connection === "offline" && (
        <div className="card chat-banner offline">Disconnected, retrying… {entries.length} cached events.</div>
      )}

      <div className="chat-columns">
        <AgentList
          summaries={summaries}
          selected={agent}
          unread={unreadByAgent}
          total={entries.length}
          onSelect={(id) => {
            setAgent(id)
            setLimit(PAGE)
          }}
        />
        <Timeline
          all={entries}
          filtered={filtered}
          index={index}
          filter={filter}
          onFilter={update}
          onClear={clear}
          senders={senders}
          receivers={receivers}
          selectedKey={selectedKey}
          onSelect={setSelectedKey}
          limit={limit}
          onShowMore={() => setLimit((l) => l + PAGE)}
          connection={connection}
          demo={demo}
          agentFilter={agent}
        />
        <DetailPanel
          selected={selected}
          root={root}
          replies={replies}
          index={index}
          onSelect={setSelectedKey}
          onIsolate={(c) => update({ correlationId: c })}
        />
      </div>
    </div>
  )
}
