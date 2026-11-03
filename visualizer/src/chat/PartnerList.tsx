import { NavHead, NavRow, onArrowKeys } from "./AgentColumn"
import { summaryOf, type AgentSummary, type PartnerEntry } from "./model.mjs"

type Props = {
  agent: string | undefined
  partners: PartnerEntry[]
  summaries: Map<string, AgentSummary>
  selected: string | undefined
  onSelect: (roomId: string) => void
  onBack: () => void
  now: number
}

/** Column 2: the selected agent's conversation partners (one per pair room), newest message first. */
export function PartnerList({ agent, partners, summaries, selected, onSelect, onBack, now }: Props) {
  return (
    <aside className="card chat-col chat-rooms chat-partners" aria-label="Conversations" onKeyDown={onArrowKeys}>
      <NavHead title={agent ? `Conversations · ${agent}` : "Conversations"} onBack={onBack} />
      {partners.map(({ partner, room }) => (
        <NavRow
          key={room.id}
          id={room.id}
          avatarId={partner}
          status={summaries.get(partner)?.status ?? "unknown"}
          title={partner}
          preview={`${room.lastMsg.sender}: ${summaryOf(room.lastMsg.ev) || room.lastMsg.ev.type}`}
          last={room.lastMsg}
          unread={room.unread}
          selected={selected === room.id}
          now={now}
          onSelect={() => onSelect(room.id)}
        />
      ))}
      {agent && partners.length === 0 && <div className="chat-empty muted">{agent} has no conversations yet.</div>}
      {!agent && <div className="chat-empty muted">Select an agent.</div>}
    </aside>
  )
}
