import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { MIN_SAMPLES, estimate, fmt, fmtRough, percentile, render, renderEstimate, snapshot, stats } from "../eta.mjs"

const T0 = Date.parse("2026-11-03T08:00:00.000Z")
const iso = (ms) => new Date(ms).toISOString()

function fixture() {
  const state = mkdtempSync(join(tmpdir(), "eta-"))
  mkdirSync(join(state, "jobs"), { recursive: true })
  mkdirSync(join(state, "executions"), { recursive: true })
  return state
}

function addJob(state, id, { route = "feature", status = "succeeded", startMs = T0, durMs = 60_000, turns = false } = {}) {
  const dir = join(state, "jobs", id)
  const body = { task_id: id, route, status, created_at: iso(startMs), turn_created_at: iso(startMs), started_at: iso(startMs), finished_at: status === "running" ? null : iso(startMs + durMs), turn: 1 }
  if (turns) {
    mkdirSync(join(dir, "turns", "1"), { recursive: true })
    writeFileSync(join(dir, "turns", "1", "status.json"), JSON.stringify(body))
  } else mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "status.json"), JSON.stringify(body))
}

function addExec(state, id, taskId, { agent = "coder", status = "succeeded", startMs = T0, durMs = 30_000, calls = 12, failed = 0 } = {}) {
  const dir = join(state, "executions", id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "record.json"), JSON.stringify({
    execution_id: id, task_id: taskId, agent_id: agent, status, created_at: iso(startMs), started_at: iso(startMs),
    duration_ms: status === "running" ? null : durMs, tool_calls: { count: calls, failed },
  }))
}

test("fmt and fmtRough", () => {
  assert.equal(fmt(42_000), "42s")
  assert.equal(fmt(185_000), "3m 05s")
  assert.equal(fmt(3_900_000), "1h 05m")
  assert.equal(fmtRough(25_000), "~30s")
  assert.equal(fmtRough(250_000), "~4m")
})

test("percentile and stats", () => {
  assert.equal(percentile([], 0.5), null)
  assert.deepEqual(stats([10, 30, 20]), { n: 3, p25: 15, median: 20, p75: 25 })
})

test("estimate: not enough history says so", () => {
  const e = estimate(stats([60_000, 90_000]), 10_000)
  assert.equal(e.known, false)
  assert.equal(e.samples, 2)
})

test("estimate: remaining time from the median, clamped at zero", () => {
  const st = stats([60_000, 120_000, 180_000])
  const e = estimate(st, 30_000)
  assert.equal(e.known, true)
  assert.equal(e.overrun, false)
  assert.equal(e.remainingMs, 90_000)
  assert.equal(e.lowMs, 60_000) // p25 = 90 s, minus 30 s elapsed
  assert.equal(e.highMs, 120_000) // p75 = 150 s, minus 30 s elapsed
  assert.equal(estimate(st, 140_000).remainingMs, 0) // past the median, still inside the usual range
})

test("estimate: past the usual range gives no made-up number", () => {
  const e = estimate(stats([60_000, 120_000, 180_000]), 400_000)
  assert.equal(e.overrun, true)
  assert.equal(e.remainingMs, null)
})

test("renderEstimate uses finished successful turns of that route only", () => {
  const state = fixture()
  addJob(state, "T-a", { durMs: 60_000 })
  addJob(state, "T-b", { durMs: 120_000, turns: true })
  addJob(state, "T-c", { durMs: 180_000 })
  addJob(state, "T-d", { route: "bugfix", durMs: 999_000 })
  addJob(state, "T-e", { status: "failed", durMs: 999_000 })
  assert.match(renderEstimate(state, "feature"), /typically ~2m .*from 3 earlier runs/)
  assert.match(renderEstimate(state, "bugfix"), /no reliable estimate yet — only 1/)
  assert.ok(MIN_SAMPLES >= 3)
})

test("snapshot of a running task: steps, tool calls, ETA excluding itself from history", () => {
  const state = fixture()
  for (const [i, d] of [60_000, 120_000, 180_000].entries()) addJob(state, `T-h${i}`, { durMs: d })
  addJob(state, "T-now", { status: "running", startMs: T0 })
  addExec(state, "ex_00000001_aaaaaaaa", "T-now", { agent: "scout", durMs: 20_000, calls: 5, startMs: T0 + 1000 })
  addExec(state, "ex_00000002_bbbbbbbb", "T-now", { agent: "coder", status: "running", startMs: T0 + 30_000, calls: 70, failed: 12 })
  const snap = snapshot(state, "T-now", T0 + 45_000)
  assert.equal(snap.status, "running")
  assert.equal(snap.elapsedMs, 45_000)
  assert.equal(snap.steps.length, 2)
  assert.equal(snap.steps[1].ms, 15_000)
  assert.equal(snap.estimate.remainingMs, 75_000)
  const out = render(snap)
  assert.match(out, /✓ scout 20s · 5 calls/)
  assert.match(out, /▶ coder 15s · 70 calls, 12 failed ⚠ many tool calls/)
  assert.match(out, /ETA ~1m left/)
})

test("snapshot of a finished task reports the total instead of an ETA", () => {
  const state = fixture()
  addJob(state, "T-done", { durMs: 90_000 })
  const out = render(snapshot(state, "T-done", T0 + 500_000))
  assert.match(out, /finished in 1m 30s with status succeeded/)
  assert.doesNotMatch(out, /ETA/)
})

test("planning phase and unknown task", () => {
  const state = fixture()
  addJob(state, "T-new", { status: "running" })
  assert.match(render(snapshot(state, "T-new", T0 + 5000)), /Hermes is still planning/)
  assert.match(render(snapshot(state, "T-missing")), /not found/)
})
