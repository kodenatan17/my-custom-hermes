// Workflow (office.ts) reducer regression: the Agent Interaction Viewer change only added `default: return state`
// and the `handback` type. Old-style event sequences must produce exactly the same state with handback / unknown
// types interleaved. office.ts is TypeScript and imports agents.ts (Vite's import.meta.glob), so it is loaded with
// Node's built-in type stripping plus a module hook that resolves "./agents" and stubs the glob (no new deps).
import { test, describe, before } from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "./agents" && ctx.parentURL?.endsWith("/src/office.ts")) return next("./agents.ts", ctx)
    return next(spec, ctx)
  },
  load(url, ctx, next) {
    if (url.endsWith("/src/agents.ts")) {
      const source = readFileSync(fileURLToPath(url), "utf8").replace(/import\.meta\.glob<string>\([^)]*\)/, "({})")
      return { format: "module-typescript", source, shortCircuit: true }
    }
    return next(url, ctx)
  },
})

/** @type {{ reducer: Function, initialState: any }} */
let office
before(async () => {
  office = await import("../src/office.ts")
})

const T = 1_700_000_000_000
const S = "claude:S"
/** Pre-change event vocabulary only. */
const OLD = [
  { ts: T + 1, type: "prompt", agent: "build", sessionID: S, text: "Tambah reset password" },
  { ts: T + 2, type: "activity", agent: "orchestrator", sessionID: S, text: "read orchestrator.md" },
  { ts: T + 3, type: "dispatch", agent: "orchestrator", target: "scout", sessionID: S, text: "Cari auth" },
  { ts: T + 4, type: "busy", agent: "scout", sessionID: S, text: "Cari auth" },
  { ts: T + 5, type: "activity", agent: "scout", sessionID: S, text: 'grep "Login"' },
  { ts: T + 6, type: "idle", agent: "scout", sessionID: S },
  { ts: T + 7, type: "idle", agent: "scout", sessionID: S }, // duplicate idle must not double-count
  { ts: T + 8, type: "dispatch", agent: "orchestrator", target: "coder", sessionID: S, text: "Implement" },
  { ts: T + 9, type: "lock.waiting", agent: "coder", source: "opencode", sessionID: S, feature: "auth", waitingOn: { source: "claude", feature: "auth" } },
  { ts: T + 10, type: "lock.acquired", agent: "coder", source: "opencode", sessionID: S, feature: "auth" },
  { ts: T + 11, type: "activity", agent: "coder", sessionID: S, text: "edit page.dart" },
  { ts: T + 12, type: "idle", agent: "coder", sessionID: S },
  { ts: T + 13, type: "lock.released", agent: "coder", source: "opencode", sessionID: S, feature: "auth" },
  { ts: T + 14, type: "lock.override", agent: "qa", source: "cline", sessionID: S, feature: "auth", waitingOn: { source: "claude", feature: "auth" } },
  { ts: T + 15, type: "lock.acquired", agent: "devops", source: "claude", sessionID: S, feature: "home" },
  { ts: T + 16, type: "lock.expired", agent: "devops", source: "claude", sessionID: S, feature: "home", reason: "stale" },
  { ts: T + 17, type: "error", agent: "qa", sessionID: S, text: "flutter test gagal" },
  { ts: T + 18, type: "idle", agent: "orchestrator", sessionID: S },
]

/** New-style noise that the Workflow view must ignore. */
const noise = (ts) => [
  { ts, type: "handback", agent: "scout", target: "orchestrator", sessionID: S, correlationId: "claude:t1", status: "ok", result: "done" },
  { ts, type: "handback", agent: "coder", target: "orchestrator", sessionID: S, correlationId: "claude:t2", status: "error", error: "x" },
  { ts, type: "handback", agent: "qa", target: "orchestrator", sessionID: S, status: "unknown" }, // qa is waiting/warned at some points
  { ts, type: "totally.new", agent: "coder", sessionID: S },
  { ts, type: "lock.something", agent: "coder", sessionID: S, feature: "auth" },
]

const run = (events, from) => events.reduce((s, event) => office.reducer(s, { type: "event", event }), from ?? office.initialState)
const interleave = (events) => events.flatMap((e) => [...noise(e.ts), e, ...noise(e.ts)])

describe("Workflow reducer regression (office.ts)", () => {
  test("old-style sequence: pinned outcome (counters, pending, statuses, locks, log)", () => {
    const s = run(OLD)
    assert.equal(s.dispatched, 2)
    assert.equal(s.completed, 2)
    assert.deepEqual(s.pending, { scout: 0, coder: 0 })
    assert.equal(s.orchestratorTarget, null)
    assert.equal(s.startedAt, T + 1)
    assert.deepEqual(s.locks, {}) // auth released, home expired
    assert.deepEqual(
      Object.fromEntries(Object.entries(s.agents).map(([id, a]) => [id, a.status])),
      { orchestrator: "done", scout: "done", coder: "done", qa: "error", devops: "idle" },
    )
    assert.equal(s.agents.scout.calls, 1)
    assert.equal(s.agents.qa.warning, undefined, "a non-lock event clears the override warning")
    assert.deepEqual(
      s.log.map((l) => l.kind),
      ["prompt", "activity", "dispatch", "activity", "idle", "dispatch", "lock.waiting", "lock.acquired", "activity", "idle", "lock.released", "lock.override", "lock.acquired", "lock.expired", "error", "idle"],
    )
  })

  test("handback / unknown types interleaved everywhere: state identical to the old-only run", () => {
    assert.deepEqual(run(interleave(OLD)), run(OLD))
  })

  test("identical at every intermediate step too, and handback returns the very same state object", () => {
    let a = office.initialState
    let b = office.initialState
    for (const e of OLD) {
      for (const n of noise(e.ts)) {
        const next = office.reducer(b, { type: "event", event: n })
        assert.equal(next, b, `${n.type} must be a no-op`)
        b = next
      }
      a = office.reducer(a, { type: "event", event: e })
      b = office.reducer(b, { type: "event", event: e })
      assert.deepEqual(b, a, `after ${e.type}@${e.ts}`)
    }
  })

  test("handback as the very first event does not set startedAt; the first real event does", () => {
    const s = run([noise(T)[0], OLD[0]])
    assert.equal(s.startedAt, T + 1)
    assert.equal(run([noise(T)[0]]).startedAt, undefined)
  })

  test("handback does not clear a lock-wait (waitingOn) or count as completion", () => {
    const waiting = run(OLD.slice(0, 9)) // coder is waiting on auth
    assert.ok(waiting.agents.coder.waitingOn)
    const after = run([{ ts: T + 50, type: "handback", agent: "coder", target: "orchestrator", sessionID: S, status: "ok" }], waiting)
    assert.equal(after, waiting)
    assert.equal(after.completed, waiting.completed)
  })

  test("hello replay path (reset, then replay incl. new types) equals a fresh old-only run", () => {
    const dirty = run(OLD.slice(0, 5))
    const reset = office.reducer(dirty, { type: "reset" })
    assert.deepEqual(run(interleave(OLD), reset), run(OLD))
  })

  test("events carrying the new optional fields (eventId, correlationId, prompt...) behave like before", () => {
    const enriched = OLD.map((e, i) => ({ ...e, eventId: `b-${i}`, correlationId: `claude:c${i}`, prompt: "p", requestedAgent: "general-purpose", durationMs: 5 }))
    assert.deepEqual(run(enriched), run(OLD))
  })
})
