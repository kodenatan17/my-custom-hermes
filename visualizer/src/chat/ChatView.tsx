import { useEffect, useMemo, useState } from "react"
import type { Connection, UnreadState } from "../useOfficeStream"
import { AgentList } from "./AgentColumn"
import { DetailPanel } from "./DetailPanel"
import {
  agentEntries,
  agentSummaries,
  buildIndex,
  buildRooms,
  DEFAULT_KINDS,
  filterEntries,
  linkedEvents,
  partnersOf,
  roomEntries,
  threadRootOf,
  USER,
  type InteractionState,
} from "./model.mjs"
import { PartnerList } from "./PartnerList"
import { Timeline } from "./Timeline"

/** Live `matchMedia` flag (narrow = single-pane layout). */
function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [query])
  return match
}

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

/** Narrow screens show one pane at a time: agents -> conversations -> messages. */
type Pane = "agents" | "partners" | "messages"

type Props = {
  interactions: InteractionState
  connection: Connection
  demo: boolean
  unread: UnreadState
  onSeen: (agent: string, seq: number) => void
}

/** Agent Chat View (read-only monitoring): agents | their conversations | messages of one pair | thread. */
export function ChatView({ interactions, connection, demo, unread, onSeen }: Props) {
  const { entries } = interactions
  const narrow = useMedia("(max-width: 699px)")
  // undefined = follow the default (orchestrator first, its newest conversation) until the user picks one.
  const [agentId, setAgentId] = useState<string | undefined>(undefined)
  const [roomId, setRoomId] = useState<string | undefined>(undefined)
  const [pane, setPane] = useState<Pane>("agents")
  const [filter, setFilter] = useState<ChatFilterState>(EMPTY_FILTER)
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  // Time presets are relative to "now": refresh them even when no events arrive.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [])

  const index = useMemo(() => buildIndex(entries), [entries])
  const summaries = useMemo(() => agentSummaries(entries), [entries])
  const rooms = useMemo(() => buildRooms(entries, unread.baseline, unread.seen), [entries, unread])
  const agents = useMemo(() => agentEntries(rooms), [rooms])
  // A picked agent / room that vanished (older events trimmed) falls back to the default instead of an empty pane.
  const currentAgent = agents.some((a) => a.id === agentId) ? agentId : agents[0]?.id
  const partners = useMemo(() => (currentAgent ? partnersOf(rooms, currentAgent) : []), [rooms, currentAgent])
  const room = useMemo(() => partners.find((p) => p.room.id === roomId)?.room ?? partners[0]?.room, [partners, roomId])

  // Viewing a conversation marks it read (also for events arriving while it is open). On narrow screens only while it is shown.
  const roomShown = !narrow || pane === "messages"
  const shownRoomId = room?.id // a string dep: marking read rebuilds `rooms` (and the room object) but not its id
  useEffect(() => {
    if (roomShown && shownRoomId) onSeen(shownRoomId, interactions.seq)
  }, [roomShown, shownRoomId, interactions.seq, onSeen])

  // Esc closes the filter menu first, then the detail panel / overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (filterOpen) setFilterOpen(false)
      else if (selectedKey) setSelectedKey(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [filterOpen, selectedKey])

  const inRoomEntries = useMemo(() => (room ? roomEntries(room, entries) : []), [room, entries])
  const filtered = useMemo(
    () => filterEntries(inRoomEntries, { ...filter, sinceMs: filter.sinceMs || undefined }, index, now),
    [inRoomEntries, filter, index, now],
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
    setLimit(PAGE)
  }
  const resetRoomView = () => {
    setSelectedKey(null)
    setFilterOpen(false)
    setLimit(PAGE)
  }
  const openAgent = (id: string) => {
    setAgentId(id)
    setRoomId(undefined) // its newest conversation
    setPane("partners")
    resetRoomView()
  }
  const openRoom = (id: string) => {
    setAgentId(currentAgent)
    setRoomId(id)
    setPane("messages")
    resetRoomView()
  }

  return (
    <div className="chat" data-pane={narrow ? pane : "all"}>
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
        <AgentList agents={agents} summaries={summaries} selected={currentAgent} onSelect={openAgent} now={now} />
        <PartnerList
          agent={currentAgent}
          partners={partners}
          summaries={summaries}
          selected={room?.id}
          onSelect={openRoom}
          onBack={() => setPane("agents")}
          now={now}
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
          room={room}
          summaries={summaries}
          onBack={() => {
            setPane("partners")
            setSelectedKey(null)
          }}
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((o) => !o)}
          now={now}
          parseErrors={interactions.parseErrors}
          historyDropped={interactions.historyDropped}
        />
        {selected && <div className="chat-backdrop" onClick={() => setSelectedKey(null)} />}
        <DetailPanel
          selected={selected}
          root={root}
          replies={replies}
          index={index}
          onSelect={setSelectedKey}
          onIsolate={(c) => update({ correlationId: c })}
          onClose={() => setSelectedKey(null)}
        />
      </div>
    </div>
  )
}
