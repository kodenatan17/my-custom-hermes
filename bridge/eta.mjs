// Progress snapshot + estimated time left for a Hermes task, read-only from the Hermes Agent OS state dir.
//
//   oc-eta <task_id> [--json]          where the task is now: elapsed, steps done/running, tool calls, ETA
//   oc-eta estimate <route>            expected duration of a route before it starts
//   oc-eta wait <task_id> [--max S]    `oc wait` (live events) for up to S seconds (default 110), then the snapshot
//
// The ETA is a historical estimate: the median of earlier finished turns of the same route (range = 25th..75th
// percentile). With fewer than MIN_SAMPLES finished turns it says so instead of guessing.
import { spawn } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const MIN_SAMPLES = 3
// A running agent with this many tool calls is flagged: the 90th percentile of history is ~50-60 calls.
export const MANY_TOOL_CALLS = 60
const ACTIVE = new Set(["queued", "running"])
const TERMINAL = new Set(["succeeded", "failed", "timeout", "cancelled", "lost"])
// Agent runs under this are almost always instant failures, not real work; they would drag medians down.
const MIN_AGENT_MS = 15_000

export const stateDir = (env = process.env) => env.AGENT_OS_STATE_DIR || join(env.HOME || homedir(), ".local", "state", "hermes-agent-os")

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

export function fmt(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`
}

// Coarser, for estimates: "~40s", "~4m", "~1h 05m".
export function fmtRough(ms) {
  if (ms < 60_000) return `~${Math.max(10, Math.round(ms / 10_000) * 10)}s`
  const m = Math.round(ms / 60_000)
  return m < 60 ? `~${m}m` : `~${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`
}

export function percentile(sorted, p) {
  if (!sorted.length) return null
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

export function stats(values) {
  const v = [...values].sort((a, b) => a - b)
  return { n: v.length, p25: percentile(v, 0.25), median: percentile(v, 0.5), p75: percentile(v, 0.75) }
}

// Every finished turn of every task: { taskId, route, ms }. Older tasks have only status.json, newer ones turns/<n>/status.json.
export function finishedTurns(state) {
  const jobs = join(state, "jobs")
  if (!existsSync(jobs)) return []
  const out = []
  for (const id of readdirSync(jobs)) {
    const dir = join(jobs, id)
    const turnsDir = join(dir, "turns")
    const files = existsSync(turnsDir) ? readdirSync(turnsDir).map((t) => join(turnsDir, t, "status.json")) : [join(dir, "status.json")]
    for (const file of files) {
      const s = readJson(file)
      if (!s || s.status !== "succeeded" || !s.started_at || !s.finished_at) continue
      const ms = Date.parse(s.finished_at) - Date.parse(s.started_at)
      if (ms > 0) out.push({ taskId: id, route: s.route ?? s.mode ?? "unknown", ms })
    }
  }
  return out
}

export function executionsOf(state, taskId, sinceMs = 0) {
  const dir = join(state, "executions")
  if (!existsSync(dir)) return []
  const out = []
  for (const id of readdirSync(dir)) {
    const r = readJson(join(dir, id, "record.json"))
    if (r?.task_id === taskId && Date.parse(r.created_at) >= sinceMs) out.push(r)
  }
  return out.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
}

// Median successful run per agent over all history, for "usually takes ~X" next to a running step.
export function agentMedians(state) {
  const dir = join(state, "executions")
  const by = {}
  if (!existsSync(dir)) return {}
  for (const id of readdirSync(dir)) {
    const r = readJson(join(dir, id, "record.json"))
    if (r?.status === "succeeded" && r.duration_ms >= MIN_AGENT_MS) (by[r.agent_id] ??= []).push(r.duration_ms)
  }
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, stats(v)]))
}

export function routeStats(state, route, excludeTaskId) {
  return stats(finishedTurns(state).filter((t) => t.route === route && t.taskId !== excludeTaskId).map((t) => t.ms))
}

// What is left, given elapsed time and the route's history.
export function estimate(st, elapsedMs) {
  if (st.n < MIN_SAMPLES) return { known: false, samples: st.n }
  const left = (v) => Math.max(0, v - elapsedMs)
  const overrun = elapsedMs > st.p75
  return {
    known: true,
    samples: st.n,
    overrun,
    // Past the usual range, the history says nothing about the end: report that instead of a made-up number.
    remainingMs: overrun ? null : left(st.median),
    lowMs: overrun ? null : left(st.p25),
    highMs: overrun ? null : left(st.p75),
    totalMedianMs: st.median,
    percent: Math.min(95, Math.round((elapsedMs / st.median) * 100)),
  }
}

function etaText(est, now) {
  if (!est.known) return `ETA unknown yet — only ${est.samples} finished run(s) of this route in history (need ${MIN_SAMPLES})`
  if (est.overrun) return `ETA unknown — already past the usual range for this route (typical total ${fmtRough(est.totalMedianMs)}, ${est.samples} runs)`
  const at = new Date(now + est.remainingMs).toTimeString().slice(0, 5)
  return `ETA ${fmtRough(est.remainingMs)} left (range ${fmtRough(est.lowMs)}–${fmtRough(est.highMs).slice(1)}, done around ${at}) · ~${est.percent}% by time · from ${est.samples} earlier runs of this route`
}

export function snapshot(state, taskId, now = Date.now()) {
  const job = readJson(join(state, "jobs", taskId, "status.json"))
  if (!job) return { error: `task ${taskId} not found in ${state}` }
  const turnStart = Date.parse(job.turn_created_at ?? job.created_at)
  const started = Date.parse(job.started_at ?? job.turn_created_at ?? job.created_at)
  const ended = job.finished_at ? Date.parse(job.finished_at) : null
  const elapsedMs = (ended ?? now) - started
  const route = job.route ?? job.mode ?? "unknown"
  const medians = agentMedians(state)
  const steps = executionsOf(state, taskId, turnStart - 5000).map((e) => {
    const done = TERMINAL.has(e.status)
    const ms = done ? e.duration_ms : now - Date.parse(e.started_at ?? e.created_at)
    return { agent: e.agent_id, status: e.status, ms, usualMs: medians[e.agent_id]?.median ?? null, tools: e.tool_calls?.count ?? null, failedTools: e.tool_calls?.failed ?? 0 }
  })
  const est = ACTIVE.has(job.status) ? estimate(routeStats(state, route, taskId), elapsedMs) : null
  return { taskId, route, status: job.status, turn: job.turn ?? 1, elapsedMs, steps, estimate: est, now }
}

export function render(snap) {
  if (snap.error) return snap.error
  const mark = { succeeded: "✓", running: "▶", queued: "…" }
  const steps = snap.steps.map((s) => {
    const usual = s.status === "running" && s.usualMs ? ` (usually ~${fmt(s.usualMs)})` : ""
    const calls = s.tools == null ? "" : ` · ${s.tools} calls${s.failedTools ? `, ${s.failedTools} failed` : ""}`
    const warn = s.status === "running" && (s.tools >= MANY_TOOL_CALLS || s.failedTools >= 10) ? " ⚠ many tool calls" : ""
    return `${mark[s.status] ?? "✗"} ${s.agent} ${fmt(s.ms)}${usual}${calls}${warn}`
  })
  const lines = [
    `⏱ ${snap.taskId} · route ${snap.route} · ${snap.status} · ${fmt(snap.elapsedMs)} elapsed`,
    `  steps (${snap.steps.length} so far): ${steps.join("  |  ") || "Hermes is still planning, no agent started yet"}`,
  ]
  if (snap.estimate) lines.push(`  ${etaText(snap.estimate, snap.now)}`)
  else lines.push(`  finished in ${fmt(snap.elapsedMs)} with status ${snap.status}`)
  return lines.join("\n")
}

export function renderEstimate(state, route) {
  const st = routeStats(state, route)
  if (st.n < MIN_SAMPLES) return `Route ${route}: no reliable estimate yet — only ${st.n} finished run(s) in history (need ${MIN_SAMPLES}).`
  return `Route ${route}: typically ${fmtRough(st.median)} (range ${fmtRough(st.p25)}–${fmtRough(st.p75).slice(1)}), from ${st.n} earlier runs. Hermes' own planning time is included; queueing and slow model calls are not.`
}

function runOcWait(taskId, maxS) {
  const oc = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "oc")
  return new Promise((resolve) => {
    const p = spawn(oc, ["wait", taskId, "--max", String(maxS)], { stdio: "inherit" })
    p.on("exit", (code) => resolve(code ?? 1))
    p.on("error", () => resolve(1))
  })
}

export async function main(argv, env = process.env) {
  const state = stateDir(env)
  const [first, ...rest] = argv
  if (!first || first === "-h" || first === "--help") {
    console.log("usage: oc-eta <task_id> [--json] | oc-eta estimate <route> | oc-eta wait <task_id> [--max S]")
    return first ? 0 : 2
  }
  if (first === "estimate") {
    if (!rest[0]) return console.error("usage: oc-eta estimate <route>"), 2
    console.log(renderEstimate(state, rest[0]))
    return 0
  }
  if (first === "wait") {
    const taskId = rest[0]
    if (!taskId) return console.error("usage: oc-eta wait <task_id> [--max S]"), 2
    const i = rest.indexOf("--max")
    const maxS = Math.min(Math.max(Number(i >= 0 ? rest[i + 1] : 110) || 110, 5), 540)
    const code = await runOcWait(taskId, maxS)
    console.log(render(snapshot(state, taskId)))
    return code
  }
  const snap = snapshot(state, first)
  console.log(rest.includes("--json") ? JSON.stringify(snap, null, 2) : render(snap))
  return snap.error ? 1 : 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(await main(process.argv.slice(2)))
