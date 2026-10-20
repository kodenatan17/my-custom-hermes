import { useEffect, useState } from "react"
import { AGENT_BY_ID, CATEGORY_STYLE, displayName, ORCHESTRATOR_ID } from "../agents"
import type { AgentState, OfficeState } from "../office"
import { ACTIVITY_LABEL, SLOT_BY_KEY, type Activity } from "../spots"
import { countdown, LOCATION } from "../prayer"
import type { Connection } from "../useOfficeStream"
import type { PrayerView } from "../usePrayer"

type Props = {
  state: OfficeState
  hangouts: Record<string, string>
  prayer: PrayerView
  connection: Connection
  demo: boolean
  onToggleDemo: () => void
  focused: string | null
  onSelect: (id: string | null) => void
}

const STATUS_LABEL: Record<AgentState["status"], string> = {
  idle: "Standby",
  working: "Bekerja",
  done: "Selesai",
  error: "Perlu dicek",
}

const CONNECTION_LABEL: Record<Connection, string> = {
  connecting: "Menghubungkan",
  live: "Live",
  offline: "Offline",
  demo: "Demo",
}

const pad = (n: number) => String(n).padStart(2, "0")
function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}
const clock = (ts: number) => new Date(ts).toLocaleTimeString("id-ID", { hour12: false }).replace(/\./g, ":")
const hhmm = (d: Date) => clock(d.getTime()).slice(0, 5)

export function Hud({ state, hangouts, prayer, connection, demo, onToggleDemo, focused, onSelect }: Props) {
  const now = prayer.now
  const [tab, setTab] = useState<"agents" | "log">("agents")

  const active = Object.entries(state.agents)
    .filter(([, a]) => a.status !== "idle")
    .sort((a, b) => b[1].updated - a[1].updated)
  const lockList = Object.entries(state.locks)
  const working = active.filter(([, a]) => a.status === "working")
  // Prefer a busy subagent over the orchestrator, which stays busy for the whole run.
  const current = working.find(([id]) => id !== ORCHESTRATOR_ID) ?? working[0]
  const currentAgent = current && AGENT_BY_ID.get(current[0])
  const session = prayer.session
  const breakCounts = new Map<Activity, number>()
  for (const key of Object.keys(hangouts)) {
    const activity = SLOT_BY_KEY.get(key)?.activity
    if (activity) breakCounts.set(activity, (breakCounts.get(activity) ?? 0) + 1)
  }
  const breakSummary = [...breakCounts]
    .map(([a, n]) => `${n} ${ACTIVITY_LABEL[a].label.toLowerCase()} ${ACTIVITY_LABEL[a].emoji}`)
    .join(", ")
  const completed = Math.min(state.completed, state.dispatched)
  const progress = state.dispatched ? Math.min(100, Math.round((completed / state.dispatched) * 100)) : 0

  return (
    <div className="hud">
      <header className="card title-card">
        <div className="title-row">
          <h1>
            Ruang Kerja Tim <span className="muted">· Seedly</span>
          </h1>
          <button className={`demo-btn ${demo ? "on" : ""}`} onClick={onToggleDemo}>
            {demo ? "Stop demo" : "Demo"}
          </button>
        </div>
        <p className="subtitle">
          {current ? (
            <>
              Sedang bekerja: <b>{displayName(currentAgent, current[0])}</b>
              {current[1].activity ? ` (${current[1].activity})` : current[1].task ? ` (${current[1].task})` : ""}
            </>
          ) : session ? (
            `Waktunya sholat ${session.name}, yang senggang ke musholla`
          ) : connection === "live" || demo ? (
            `Menunggu prompt berikutnya${breakSummary ? ` · ${breakSummary}` : ""}`
          ) : (
            "Menunggu opencode. Jalankan opencode di project ini atau klik Demo."
          )}
        </p>
      </header>

      <div className="stats-row">
        <div className="card stat-live">
          <div className="live">
            <span className={`dot ${connection}`} />
            <div>
              <div className="stat-label">{CONNECTION_LABEL[connection]} ·</div>
              <div className="stat-value mono">{clock(now)}</div>
              <div className="stat-sub mono">sesi {state.startedAt ? elapsed(now - state.startedAt) : "00:00:00"}</div>
            </div>
          </div>
          <div className="progress">
            <div className="stat-label">Progres tugas</div>
            <div className="stat-value">{progress}%</div>
          </div>
          <div className="bar">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div className="card stat-done">
          <div className="stat-label">Tugas selesai</div>
          <div className="stat-big">
            {completed}/{state.dispatched}
          </div>
        </div>
      </div>

      <div className={`card prayer-card ${session ? "active" : ""}`}>
        <span className="prayer-icon">🕌</span>
        <div className="prayer-text">
          {session && prayer.phase ? (
            <>
              <b>{session.name === "Jumat" ? "Sholat Jumat" : `Sholat ${session.name}`} berjamaah</b>
              <span className="muted">
                {" · "}
                {prayer.phase.phase === "sholat"
                  ? `rakaat ${prayer.phase.rakaat}/${session.rakaat}`
                  : prayer.phase.phase === "doa"
                    ? "dzikir & doa"
                    : prayer.phase.phase === "khutbah"
                      ? "khutbah"
                      : `iqamah ${countdown(session.iqamah - now)}`}
                {` · ${Object.keys(prayer.places).length} jamaah`}
              </span>
            </>
          ) : (
            <>
              <b>
                {prayer.next.name} {hhmm(prayer.next.at)}
              </b>
              <span className="muted">
                {" · "}
                <span className="mono">{countdown(prayer.next.at.getTime() - now)}</span> lagi · {LOCATION.city}
              </span>
            </>
          )}
        </div>
        {!session && (
          <button className="demo-btn" onClick={prayer.startTest}>
            Tes sholat
          </button>
        )}
      </div>

      <div className="spacer" />

      <section className="bottom">
        {tab === "agents" ? (
          <div className="agent-cards">
            {lockList.length > 0 && (
              <div className="card lock-list">
                <b>Locks</b>
                {lockList.map(([feature, l]) => (
                  <div key={feature} className="muted">
                    <code>{feature}</code> · {l.source} ({l.agent})
                  </div>
                ))}
              </div>
            )}
            {active.length === 0 && <div className="card empty">Belum ada aktivitas. Kirim prompt di opencode untuk mulai.</div>}
            {active.map(([id, a]) => {
              const agent = AGENT_BY_ID.get(id)
              const style = CATEGORY_STYLE[agent?.category ?? "other"]
              return (
                <button key={id} className={`card agent-card ${focused === id ? "focused" : ""}`} onClick={() => onSelect(id)}>
                  <div className="avatar" style={{ background: style.color }}>
                    {(agent?.name ?? id).charAt(0).toUpperCase()}
                  </div>
                  <div className="agent-body">
                    <div className="agent-head">
                      <b>{agent?.name ?? id}</b>
                      {agent && <span className="muted">- {agent.role}</span>}
                      <span className={`status ${a.status}`}>● {STATUS_LABEL[a.status]}</span>
                    </div>
                    <div className="agent-task">{a.task ?? "—"}</div>
                    <div className="agent-activity muted">
                      {a.status === "working" && a.activity ? a.activity : `${a.calls} tool call`}
                    </div>
                    {a.warning && <div className="agent-warning">{a.warning}</div>}
                    {a.waitingOn && (
                      <div className="agent-waiting">
                        {agent?.name ?? id} ({a.source ?? "?"}) waiting on <code>{a.waitingOn.feature}</code> held by {a.waitingOn.source}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="card log">
            {state.log.length === 0 && <div className="muted">Log masih kosong.</div>}
            {[...state.log].reverse().map((l, i) => {
              const agent = AGENT_BY_ID.get(l.agent)
              return (
                <div key={i} className={`log-row ${l.kind}`}>
                  <span className="mono muted">{clock(l.ts)}</span>
                  <b style={{ color: CATEGORY_STYLE[agent?.category ?? "other"].color }}>{displayName(agent, l.agent)}</b>
                  <span>{l.text}</span>
                </div>
              )
            })}
          </div>
        )}
        <nav className="card tabs">
          <button className={tab === "agents" ? "active" : ""} onClick={() => setTab("agents")}>
            Agen <span className="count">{active.length}</span>
          </button>
          <button className={tab === "log" ? "active" : ""} onClick={() => setTab("log")}>
            Aktivitas <span className="count">{state.log.length}</span>
          </button>
        </nav>
      </section>
    </div>
  )
}
