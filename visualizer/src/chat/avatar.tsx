import { AGENT_BY_ID, CATEGORY_STYLE } from "../agents"
import { initialsOf, USER, type AgentSummary } from "./model.mjs"

/** Colour per agent (category colour of the roster; neutral for the user / unknown agents). */
export const agentColor = (id: string) => (id === USER ? "#64748b" : CATEGORY_STYLE[AGENT_BY_ID.get(id)?.category ?? "other"].color)

const STATUS_LABEL: Record<AgentSummary["status"], string> = { working: "working", done: "done", error: "error", unknown: "unknown" }
export const statusLabel = (s: AgentSummary["status"] | undefined) => STATUS_LABEL[s ?? "unknown"]

/** Round initials avatar; `status` adds the counterpart's task-status dot. */
export function Avatar({ id, label, status, small }: { id: string; label?: string; status?: AgentSummary["status"]; small?: boolean }) {
  return (
    <span className={`chat-avatar ${small ? "small" : ""}`} style={{ background: agentColor(id) }} aria-hidden="true">
      {label ?? initialsOf(id)}
      {status !== undefined && <span className={`chat-sdot ${status}`} title={statusLabel(status)} />}
    </span>
  )
}
