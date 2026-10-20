import { maskDeep } from "../../../bridge/mask.mjs"
import { badgeOf, durationOf, fmtDuration, rowStatus, summaryOf, type Entry, type EntryIndex } from "./model.mjs"
import { clock } from "./Timeline"

type Props = {
  /** The clicked event (its metadata/payload are shown below the thread). */
  selected: Entry | undefined
  /** Thread root: the task's dispatch when known, else the selected event. */
  root: Entry | undefined
  /** Linked events of the root (same correlationId / OpenCode child session), in time order. */
  replies: Entry[]
  index: EntryIndex
  onSelect: (key: string) => void
  onIsolate: (correlationId: string) => void
}

/** One message of the thread: header, then the full prompt / result / error body. */
function Message({ e, index, active, isRoot, onSelect }: { e: Entry; index: EntryIndex; active: boolean; isRoot: boolean; onSelect: () => void }) {
  const ev = e.ev
  const status = rowStatus(e, index)
  const dur = fmtDuration(durationOf(e, index))
  const isError = ev.type === "error" || ev.status === "error"
  return (
    <div className={`chat-thread-msg ${isRoot ? "root" : ""} ${active ? "active" : ""}`} onClick={onSelect}>
      <div className="chat-thread-head">
        <b>{e.sender === "user" ? "user" : `# ${e.sender}`}</b>
        {e.receiver && <span className="muted">→ {e.receiver}</span>}
        <span className={`chat-badge ${badgeOf(ev)}`}>{ev.type}</span>
        {status && <span className={`chat-status ${status}`}>{status}</span>}
        {dur && <span className="mono muted">{dur}</span>}
        <span className="mono muted chat-thread-time">
          {e.tsValid ? clock(ev.ts as number) : "—"}
          {!e.tsValid && <span className="chat-chip warn">ts?</span>}
        </span>
      </div>
      <div className="chat-thread-body">{summaryOf(ev).slice(0, 300)}</div>
      {ev.prompt && <pre className="chat-pre">{String(maskDeep(ev.prompt))}</pre>}
      {ev.result && <pre className="chat-pre">{String(maskDeep(ev.result))}</pre>}
      {isError && (
        <div className="chat-error">
          <pre>{String(maskDeep(ev.error ?? ev.text ?? "error"))}</pre>
        </div>
      )}
    </div>
  )
}

/** Right column (thread): root message, replies in time order, then collapsible metadata + masked payload. */
export function DetailPanel({ selected, root, replies, index, onSelect, onIsolate }: Props) {
  if (!selected || !root) {
    return (
      <aside className="card chat-col chat-detail">
        <div className="chat-empty muted">Select a message to open its thread.</div>
      </aside>
    )
  }
  const ev = selected.ev
  const meta: [string, string | undefined][] = [
    ["type", ev.type],
    ["from → to", `${selected.sender}${selected.receiver ? ` → ${selected.receiver}` : ""}`],
    ["time", selected.tsValid ? new Date(ev.ts as number).toLocaleString("en-GB", { hour12: false }) : "— (invalid timestamp, ordered by arrival)"],
    ["source", ev.source],
    ["status", rowStatus(selected, index) || undefined],
    ["duration", fmtDuration(durationOf(selected, index)) || undefined],
    ["requested agent", ev.requestedAgent],
    ["tool", ev.toolName],
    ["correlation id", ev.correlationId],
    ["session", ev.sessionID],
    ["child session", ev.childSessionID],
    ["event id", ev.eventId],
  ]

  return (
    <aside className="card chat-col chat-detail">
      <div className="chat-section muted">Thread</div>
      <Message e={root} index={index} isRoot active={root === selected} onSelect={() => onSelect(root.key)} />
      <div className="chat-section muted">
        {replies.length} {replies.length === 1 ? "reply" : "replies"}
      </div>
      {replies.length === 0 && <div className="muted">No linked events (no correlation id or child session).</div>}
      <div className="chat-thread-replies">
        {replies.map((r) => (
          <Message key={r.key} e={r} index={index} isRoot={false} active={r === selected} onSelect={() => onSelect(r.key)} />
        ))}
      </div>

      <details className="chat-collapse">
        <summary className="muted">Details of the selected message</summary>
        <dl className="chat-meta">
          {meta
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt className="muted">{k}</dt>
                <dd className="mono">
                  {k === "correlation id" ? (
                    <button className="chat-corr mono" onClick={() => onIsolate(v!)} title="Isolate this task in the feed">
                      {v}
                    </button>
                  ) : (
                    v
                  )}
                </dd>
              </div>
            ))}
        </dl>
      </details>
      <details className="chat-collapse">
        <summary className="muted">Payload (masked JSON)</summary>
        <pre className="chat-pre">{JSON.stringify(maskDeep(ev), null, 2)}</pre>
      </details>
    </aside>
  )
}
