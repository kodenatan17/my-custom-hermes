import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { createCoordinator, featureOf, configLoader, DEFAULT_CONFIG } from "../coordinator.mjs"
import { relPath, isWrite } from "../emit.mjs"
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const F = (n) => `seedly_app/lib/features/${n}/x.dart`
const S = 1000

function setup(over = {}) {
  let t = 1_000_000
  const events = []
  // Legacy tests assume pure TTL semantics: owners never go stale and the breaker never trips (new tests override both).
  const cfg = { ...DEFAULT_CONFIG, liveSeconds: 1e6, breakerDenials: 1e9, ...over }
  const c = createCoordinator({ config: cfg, publish: (e) => events.push(e), now: () => t })
  return { c, events, adv: (s) => (t += s * S), time: () => t }
}
const cl = (owner, path, extra = {}) => ({ owner, source: extra.source ?? owner, sessionID: owner, agent: "orchestrator", path, ...extra })

describe("1 same feature contention", () => {
  test("A granted, B denied held with holder=A source, one lock.waiting on retries", () => {
    const { c, events, adv } = setup()
    assert.equal(c.claim(cl("a", F("auth"), { source: "claude" })).granted, true)
    let r
    for (let i = 0; i < 5; i++) { adv(1); r = c.claim(cl("b", F("auth"), { source: "cline" })) }
    assert.equal(r.granted, false)
    assert.equal(r.reason, "held")
    assert.equal(r.holder.source, "claude")
    assert.equal(c.snapshot().locks.length, 1)
    assert.equal(events.filter((e) => e.type === "lock.waiting").length, 1)
    assert.equal(events.filter((e) => e.type === "lock.waiting")[0].waitingOn.source, "claude")
  })
})

describe("2-4 features and paths", () => {
  test("2 different features both granted", () => {
    const { c } = setup()
    assert.equal(c.claim(cl("a", F("auth"))).granted, true)
    assert.equal(c.claim(cl("b", F("home"))).granted, true)
    assert.equal(c.snapshot().locks.length, 2)
  })
  test("3 shared: pubspec by A, router by B => B denied", () => {
    const { c } = setup()
    assert.equal(c.claim(cl("a", "seedly_app/pubspec.yaml")).feature, "_shared")
    const r = c.claim(cl("b", "seedly_app/lib/cores/router/app_router.dart"))
    assert.equal(r.granted, false)
    assert.equal(r.feature, "_shared")
  })
  test("3b shared: dependency dir and pubspec.lock also shared", () => {
    const c = DEFAULT_CONFIG
    assert.equal(featureOf("seedly_app/lib/cores/dependency/di.dart", c), "_shared")
    assert.equal(featureOf("seedly_app/pubspec.lock", c), "_shared")
  })
  test("4 non-feature path granted with feature null, no lock", () => {
    const { c } = setup()
    const r = c.claim(cl("a", "README.md"))
    assert.deepEqual(r, { granted: true, feature: null })
    assert.equal(c.snapshot().locks.length, 0)
  })
  test("4b relPath: absolute vs relative normalize to same; outside root => empty", () => {
    const root = "/repo"
    assert.equal(relPath("/repo/seedly_app/lib/features/a/x.dart", root), "seedly_app/lib/features/a/x.dart")
    assert.equal(relPath("seedly_app/lib/features/a/x.dart", root), "seedly_app/lib/features/a/x.dart")
    assert.equal(relPath("/other/x.dart", root), "")
    assert.equal(relPath("", root), "")
    assert.equal(relPath(undefined, root), "")
  })
})

describe("5 reentrancy / heartbeat", () => {
  test("same owner, two agents granted; heartbeat extends expiresAt", () => {
    const { c, adv } = setup()
    const r1 = c.claim({ ...cl("a", F("auth")), agent: "coder" })
    adv(100)
    const r2 = c.claim({ ...cl("a", F("auth")), agent: "qa" })
    assert.equal(r2.granted, true)
    assert.equal(r2.expiresAt - r1.expiresAt, 100 * S)
    assert.equal(c.snapshot().locks.length, 1)
  })
  test("denied claim does NOT heartbeat holder", () => {
    const { c, adv } = setup()
    const r1 = c.claim(cl("a", F("auth")))
    adv(100)
    assert.equal(c.claim(cl("b", F("auth"))).granted, false)
    assert.equal(c.snapshot().locks[0].expiresAt, r1.expiresAt)
  })
})

describe("6-8 expiry and release", () => {
  test("6 TTL expiry => lock.expired, B granted", () => {
    const { c, events, adv } = setup()
    c.claim(cl("a", F("auth")))
    assert.equal(c.claim(cl("b", F("auth"))).granted, false)
    adv(601)
    const r = c.claim(cl("b", F("auth")))
    assert.equal(r.granted, true)
    const ex = events.filter((e) => e.type === "lock.expired")
    assert.equal(ex.length, 1)
    assert.equal(ex[0].feature, "auth")
  })
  test("6b lock not expired just before TTL", () => {
    const { c, adv } = setup()
    c.claim(cl("a", F("auth")))
    adv(599)
    assert.equal(c.claim(cl("b", F("auth"))).granted, false)
  })
  test("7 crash (no release/heartbeat): after TTL new owner granted; sweep alone emits expired", () => {
    const { c, events, adv } = setup()
    c.touch("z", "z") // another tool is live, so the lock is visible (silent locks emit no lock.expired)
    c.claim(cl("a", F("auth")))
    adv(700)
    c.sweep()
    assert.equal(events.filter((e) => e.type === "lock.expired").length, 1)
    assert.equal(c.snapshot().locks.length, 0)
    assert.equal(c.claim(cl("b", F("auth"))).granted, true)
  })
  test("8 release frees all owner locks and waiter entries; other owner no-op; idempotent", () => {
    const { c, events } = setup()
    c.claim(cl("a", F("auth")))
    c.claim(cl("a", F("home")))
    c.claim(cl("b", F("pay")))
    c.claim(cl("a", F("pay"))) // a waits on pay
    assert.equal(c.snapshot().waiters.length, 1)
    assert.deepEqual(c.release({ owner: "zzz" }), { released: [] })
    assert.equal(c.snapshot().locks.length, 3)
    assert.deepEqual(c.release({ owner: "a" }).released.sort(), ["auth", "home"])
    assert.equal(c.snapshot().waiters.length, 0)
    assert.deepEqual(c.release({ owner: "a" }), { released: [] })
    assert.equal(events.filter((e) => e.type === "lock.released").length, 2)
    assert.equal(c.snapshot().locks[0].owner, "b")
  })
  test("8b release with feature only frees that feature", () => {
    const { c } = setup()
    c.claim(cl("a", F("auth")))
    c.claim(cl("a", F("home")))
    assert.deepEqual(c.release({ owner: "a", feature: "auth" }).released, ["auth"])
    assert.equal(c.snapshot().locks[0].feature, "home")
  })
})

// Holder H on x; waiters enqueue (spaced 1s), H releases, then each retries once; returns grant order.
function drain(c, adv, waiters, feature = "x") {
  const order = []
  const pending = new Set(waiters.map((w) => w.owner))
  for (let round = 0; round < 20 && pending.size; round++) {
    for (const w of waiters) {
      if (!pending.has(w.owner)) continue
      adv(1)
      const r = c.claim({ ...cl(w.owner, F(feature)), priority: w.priority, phase: w.phase })
      if (r.granted) { order.push(w.owner); pending.delete(w.owner); c.release({ owner: w.owner }) }
      else assert.equal(r.reason === "reserved" || r.reason === "held", true)
    }
  }
  return order
}
function enqueue(c, adv, ws) {
  c.claim(cl("H", F("x")))
  for (const w of ws) {
    adv(1)
    const r = c.claim({ ...cl(w.owner, F("x")), priority: w.priority, phase: w.phase })
    assert.equal(r.granted, false)
  }
  c.release({ owner: "H" })
}

describe("9-10 ordering", () => {
  test("9 priority: low,normal,high enqueued => high,normal,low; non-head gets reserved", () => {
    const { c, adv } = setup()
    const ws = [{ owner: "low", priority: "low" }, { owner: "normal", priority: "normal" }, { owner: "high", priority: "high" }]
    enqueue(c, adv, ws)
    adv(1)
    const r = c.claim({ ...cl("low", F("x")), priority: "low" })
    assert.equal(r.granted, false)
    assert.equal(r.reason, "reserved")
    assert.equal(r.holder.sessionID, "high")
    assert.deepEqual(drain(c, adv, ws), ["high", "normal", "low"])
  })
  test("10 phase tiebreak: integration enqueued first, slicing second => slicing first", () => {
    const { c, adv } = setup()
    const ws = [{ owner: "int", phase: "integration" }, { owner: "sli", phase: "slicing" }]
    enqueue(c, adv, ws)
    assert.deepEqual(drain(c, adv, ws), ["sli", "int"])
  })
  test("10b FIFO for equal priority+phase", () => {
    const { c, adv } = setup()
    const ws = ["w1", "w2", "w3"].map((owner) => ({ owner, priority: "normal", phase: "slicing" }))
    enqueue(c, adv, ws)
    assert.deepEqual(drain(c, adv, ws), ["w1", "w2", "w3"])
  })
  test("10c unknown phase sorts after known phases", () => {
    const { c, adv } = setup()
    const ws = [{ owner: "weird", phase: "zzz" }, { owner: "int", phase: "integration" }]
    enqueue(c, adv, ws)
    assert.deepEqual(drain(c, adv, ws), ["int", "weird"])
  })
})

describe("11 aging", () => {
  const cfg = { ttlSeconds: 1e6, waiterTtlSeconds: 30 }
  // keep the waiter alive by retrying every 10s for `secs`
  const wait = (c, adv, secs, ws) => { for (let i = 0; i < secs / 10; i++) { adv(10); for (const w of ws) c.claim({ ...cl(w.owner, F("x")), priority: w.priority }) } }
  test("low waiting > agingSeconds ties normal and wins by age; 2*aging equals high", () => {
    const { c, adv } = setup(cfg)
    c.claim(cl("H", F("x")))
    c.claim({ ...cl("low", F("x")), priority: "low" })
    wait(c, adv, 130, [{ owner: "low", priority: "low" }])
    c.claim({ ...cl("norm", F("x")), priority: "normal" })
    let w = c.snapshot().waiters
    assert.deepEqual(w.map((x) => x.owner), ["low", "norm"])
    // at 2*aging low equals high: a newly enqueued high does not overtake (older wins)
    wait(c, adv, 120, [{ owner: "low", priority: "low" }, { owner: "norm", priority: "normal" }])
    c.claim({ ...cl("high", F("x")), priority: "high" })
    w = c.snapshot().waiters
    assert.equal(w[0].owner, "low")
  })
  test("before aging threshold low is behind normal", () => {
    const { c, adv } = setup(cfg)
    c.claim(cl("H", F("x")))
    c.claim({ ...cl("low", F("x")), priority: "low" })
    adv(10)
    c.claim({ ...cl("norm", F("x")), priority: "normal" })
    assert.deepEqual(c.snapshot().waiters.map((x) => x.owner), ["norm", "low"])
  })
  test("low is not starved by a stream of new normals", () => {
    const { c, adv } = setup(cfg)
    c.claim(cl("H", F("x")))
    c.claim({ ...cl("low", F("x")), priority: "low" })
    let n = 0
    const alive = []
    for (let i = 0; i < 30; i++) { // 300s
      adv(10)
      c.claim({ ...cl("low", F("x")), priority: "low" })
      const o = `n${n++}`
      alive.push(o)
      c.claim({ ...cl(o, F("x")), priority: "normal" })
      for (const a of alive.slice(-3)) c.claim({ ...cl(a, F("x")), priority: "normal" })
    }
    c.release({ owner: "H" })
    assert.equal(c.snapshot().waiters[0].owner, "low")
    assert.equal(c.claim({ ...cl("low", F("x")), priority: "low" }).granted, true)
  })
})

describe("12 waiter expiry", () => {
  test("head stops retrying > waiterTtl => next waiter becomes head, free lock not blocked", () => {
    const { c, adv } = setup()
    c.claim(cl("H", F("x")))
    c.claim({ ...cl("w1", F("x")), priority: "high" })
    adv(1)
    c.claim(cl("w2", F("x")))
    c.release({ owner: "H" })
    assert.equal(c.claim(cl("w2", F("x"))).reason, "reserved")
    for (let i = 0; i < 4; i++) { adv(10); c.claim(cl("w2", F("x"))) } // w1 silent 40s
    assert.equal(c.claim(cl("w2", F("x"))).granted, true)
  })
  test("all waiters gone => brand-new claimant on a free lock is granted", () => {
    const { c, adv } = setup()
    c.claim(cl("H", F("x")))
    c.claim(cl("w1", F("x")))
    c.release({ owner: "H" })
    adv(31)
    assert.equal(c.claim(cl("new", F("x"))).granted, true)
    assert.equal(c.snapshot().waiters.length, 0)
  })
  test("free lock with non-empty queue: caller becomes waiter reason reserved", () => {
    const { c } = setup()
    c.claim(cl("H", F("x")))
    c.claim(cl("w1", F("x")))
    c.release({ owner: "H" })
    const r = c.claim(cl("late", F("x")))
    assert.equal(r.reason, "reserved")
    assert.equal(c.snapshot().waiters.length, 2)
  })
})

describe("17 edge cases", () => {
  test("fail-open config: enabled=false grants everything", () => {
    const { c } = setup({ enabled: false })
    assert.equal(c.claim(cl("a", F("x"))).granted, true)
    assert.equal(c.claim(cl("b", F("x"))).granted, true)
    assert.equal(c.snapshot().locks.length, 0)
  })
  test("deadlock A(x)->y, B(y)->x: both denied, resolved via TTL", () => {
    const { c, adv } = setup()
    c.claim(cl("A", F("x"))); c.claim(cl("B", F("y")))
    assert.equal(c.claim(cl("A", F("y"))).granted, false)
    assert.equal(c.claim(cl("B", F("x"))).granted, false)
    let granted = 0
    for (let i = 0; i < 130 && !granted; i++) {
      adv(5)
      for (const [o, f] of [["A", "y"], ["B", "x"]]) if (c.claim(cl(o, F(f))).granted) granted++
    }
    assert.ok(granted > 0, "deadlock never resolved")
  })
  test("odd feature names and $-substitution", () => {
    assert.equal(featureOf("seedly_app/lib/features/we ird!/a.dart", DEFAULT_CONFIG), "we ird!")
    assert.equal(featureOf("seedly_app\\lib\\features\\win\\a.dart", DEFAULT_CONFIG), "win")
    assert.equal(featureOf("./seedly_app/lib/features/dot/a.dart", DEFAULT_CONFIG), "dot")
    assert.equal(featureOf("seedly_app/lib/features/nofile", DEFAULT_CONFIG), null)
    assert.equal(featureOf(undefined, DEFAULT_CONFIG), null)
    assert.equal(featureOf("a/b", { pathRules: [{ match: "^a/(b)", feature: "$2" }] }), "")
    assert.equal(featureOf("a/b", { pathRules: [{ match: "([", feature: "x" }] }), null) // bad regex swallowed
  })
  test("17 `..` path: client relPath normalizes it (raw coordinator does not: see report)", () => {
    const root = "/repo"
    assert.equal(relPath("seedly_app/lib/features/a/../b/x.dart", root), "seedly_app/lib/features/b/x.dart")
    assert.equal(relPath("seedly_app/lib/features/../cores/router/r.dart", root), "seedly_app/lib/cores/router/r.dart")
    assert.equal(relPath("../etc/passwd", root), "")
    assert.equal(relPath("/repo/../etc/passwd", root), "")
    // documenting current behavior of the raw coordinator on an un-normalized path
    assert.equal(featureOf("seedly_app/lib/features/a/../b/x.dart", DEFAULT_CONFIG), "a")
  })
  test("isWrite matches known write tools, not reads", () => {
    for (const t of ["Edit", "Write", "MultiEdit", "apply_patch", "applypatch", "patch"]) assert.equal(isWrite(t), true, t)
    for (const t of ["Read", "Grep", "Glob", "Bash", "read_file", undefined]) assert.equal(isWrite(t), false, String(t))
  })
  test("isWrite matches Cline native write tools write_to_file / replace_in_file / editor", () => {
    for (const t of ["write_to_file", "replace_in_file", "editor"]) assert.equal(isWrite(t), true, t)
    for (const t of ["read", "read_file", "list_files", "search_files", "grep", "glob", "bash", "execute_command"]) assert.equal(isWrite(t), false, t)
  })
})

describe("13 config loader fail-open", () => {
  const dir = mkdtempSync(join(tmpdir(), "coord-"))
  test("missing file => defaults", () => {
    assert.deepEqual(configLoader(join(dir, "nope.json"))(), DEFAULT_CONFIG)
  })
  test("invalid JSON => defaults", () => {
    const f = join(dir, "bad.json"); writeFileSync(f, "{not json")
    assert.deepEqual(configLoader(f)(), DEFAULT_CONFIG)
  })
  test("partial config merges over defaults", () => {
    const f = join(dir, "ok.json"); writeFileSync(f, JSON.stringify({ ttlSeconds: 5 }))
    const cfg = configLoader(f)()
    assert.equal(cfg.ttlSeconds, 5)
    assert.equal(cfg.waiterTtlSeconds, 30)
  })
  test("valid JSON of wrong shape (array/null) does not crash claim", () => {
    const f = join(dir, "arr.json"); writeFileSync(f, "null")
    const c = createCoordinator({ config: configLoader(f) })
    assert.equal(c.claim(cl("a", F("x"))).granted, true)
  })
})

// ---- solo mode / liveness / breaker (real liveSeconds + breaker) ----
const live = (over = {}) => setup({ liveSeconds: 120, breakerDenials: 2, breakerWindowSeconds: 60, ...over })
const lockEvents = (events) => events.filter((e) => e.type.startsWith("lock."))

describe("18 solo mode", () => {
  test("a single owner is never denied, never queued, and emits no lock.* events", () => {
    const { c, events, adv } = live()
    for (let i = 0; i < 50; i++) {
      for (const f of ["auth", "home", "pay"]) assert.equal(c.claim(cl("cline:T1", F(f), { source: "cline" })).granted, true)
      adv(20)
    }
    assert.equal(c.snapshot().waiters.length, 0)
    assert.deepEqual(lockEvents(events), [])
    c.release({ owner: "cline:T1" })
    assert.deepEqual(lockEvents(events), []) // silent release too
  })
  test("a second owner appearing sees the solo owner's lock (acquired event emitted then) and is denied", () => {
    const { c, events, adv } = live()
    c.claim(cl("a", F("auth"), { source: "claude" }))
    adv(5)
    const r = c.claim(cl("b", F("auth"), { source: "cline" }))
    assert.equal(r.granted, false)
    assert.equal(r.holder.source, "claude")
    assert.deepEqual(lockEvents(events).map((e) => e.type), ["lock.acquired", "lock.waiting"])
  })
  test("touch() from events makes an owner count as another live tool", () => {
    const { c, adv } = live()
    c.claim(cl("a", F("auth")))
    adv(10)
    c.touch("zzz", "opencode")
    assert.equal(c.snapshot().owners.find((o) => o.owner === "zzz").live, true)
    adv(121)
    assert.equal(c.snapshot().owners.find((o) => o.owner === "zzz").live, false)
  })
})

describe("19 stale holder takeover", () => {
  test("holder silent > liveSeconds is taken over with lock.expired reason stale", () => {
    const { c, events, adv } = live()
    c.claim(cl("a", F("auth")))
    adv(5)
    c.claim(cl("b", F("auth"))) // denied: a is live; makes a's lock loud
    adv(130)
    const r = c.claim(cl("b", F("auth")))
    assert.equal(r.granted, true)
    const ex = events.filter((e) => e.type === "lock.expired")
    assert.equal(ex.length, 1)
    assert.equal(ex[0].reason, "stale")
    assert.equal(c.snapshot().locks[0].owner, "b")
  })
  test("holder events (touch) keep the lock alive", () => {
    const { c, adv } = live()
    c.claim(cl("a", F("auth")))
    adv(5)
    c.claim(cl("b", F("auth")))
    for (let i = 0; i < 6; i++) { adv(60); c.touch("a", "claude"); assert.equal(c.claim(cl("b", F("auth"))).granted, false) }
  })
  test("f orphan: dead cline task's lock does not block the next cline task after liveSeconds", () => {
    const { c, events, adv } = live()
    c.claim(cl("cline:T1", F("auth"), { source: "cline" }))
    adv(30)
    assert.equal(c.claim(cl("cline:T2", F("auth"), { source: "cline" })).granted, false) // T1 still within liveSeconds
    adv(130) // T1 silent; T2 only polled once, then also quiet -> irrelevant, T2 re-claims below
    const r = c.claim(cl("cline:T2", F("auth"), { source: "cline" }))
    assert.equal(r.granted, true)
    assert.equal(events.filter((e) => e.reason === "stale").length, 1)
    assert.equal(c.snapshot().waiters.length, 0)
  })
})

describe("20 two live owners keep priority/phase/aging", () => {
  test("priority order high,normal,low with real liveness config", () => {
    const { c, adv } = live({ ttlSeconds: 1e6, breakerDenials: 1e9 })
    const ws = [{ owner: "low", priority: "low" }, { owner: "normal", priority: "normal" }, { owner: "high", priority: "high" }]
    enqueue(c, adv, ws)
    assert.deepEqual(drain(c, adv, ws), ["high", "normal", "low"])
  })
  test("held lock denies with held reason while holder is live", () => {
    const { c, adv } = live()
    c.claim(cl("H", F("x")))
    adv(1)
    assert.equal(c.claim(cl("w", F("x"))).reason, "held")
  })
})

describe("21 circuit breaker", () => {
  test("3rd denial episode within 60s is overridden with lock.override; counter resets", () => {
    const { c, events, adv } = live()
    c.claim(cl("H", F("x"), { source: "claude" }))
    adv(1)
    const w = () => c.claim(cl("w", F("x"), { source: "cline" }))
    assert.equal(w().granted, false); adv(10)
    assert.equal(w().granted, false); adv(10)
    const r = w()
    assert.equal(r.granted, true)
    assert.equal(r.override, true)
    const ov = events.filter((e) => e.type === "lock.override")
    assert.equal(ov.length, 1)
    assert.equal(ov[0].feature, "x")
    assert.equal(ov[0].waitingOn.source, "claude")
    assert.equal(c.snapshot().locks[0].owner, "H") // override does not steal the lock
    adv(10)
    assert.equal(w().granted, false) // counter reset: denied again
  })
  test("polls of one waiting episode (1s apart) count as a single denial", () => {
    const { c, adv } = live()
    c.claim(cl("H", F("x")))
    for (let i = 0; i < 20; i++) { adv(1); assert.equal(c.claim(cl("w", F("x"))).granted, false) }
  })
  test("denials older than the window do not count", () => {
    const { c, adv } = live()
    c.claim(cl("H", F("x")))
    for (let i = 0; i < 6; i++) { adv(40); c.touch("H", "claude"); assert.equal(c.claim(cl("w", F("x"))).granted, false) }
  })
  test("release clears the breaker counter", () => {
    const { c, adv } = live()
    c.claim(cl("H", F("x")))
    adv(1); c.claim(cl("w", F("x"))); adv(10); c.claim(cl("w", F("x")))
    c.release({ owner: "w" })
    adv(10)
    assert.equal(c.claim(cl("w", F("x"))).granted, false)
  })
})

describe("22 config hardening and caps", () => {
  test("h one bad regex does not disable the others", () => {
    const cfg = { sharedPaths: ["([", "^root\\.yaml$"], pathRules: [{ match: "([", feature: "bad" }, { match: "^f/([^/]+)/", feature: "$1" }] }
    assert.equal(featureOf("root.yaml", cfg), "_shared")
    assert.equal(featureOf("f/abc/x", cfg), "abc")
    assert.equal(featureOf("zzz", cfg), null)
  })
  test("i the cross-cutting feature is named _shared, not shared", () => {
    assert.equal(featureOf("seedly_app/pubspec.yaml", DEFAULT_CONFIG), "_shared")
    assert.equal(featureOf("seedly_app/lib/features/shared/x.dart", DEFAULT_CONFIG), "shared") // a real feature named shared is distinct
  })
  test("feature name is clipped to 200 chars", () => {
    assert.equal(featureOf(`seedly_app/lib/features/${"n".repeat(500)}/x.dart`, DEFAULT_CONFIG).length, 200)
  })
  test("locks map is capped at 500", () => {
    const { c } = live()
    for (let i = 0; i < 600; i++) c.claim(cl("a", F(`f${i}`)))
    assert.ok(c.snapshot().locks.length <= 500)
  })
  test("DEFAULT_CONFIG: cline max wait 45s + onConflict, liveSeconds 120, breaker 2/60", () => {
    assert.equal(DEFAULT_CONFIG.maxWaitSeconds.cline, 45)
    assert.deepEqual(DEFAULT_CONFIG.onConflict, { cline: "wait", claude: "deny", opencode: "deny" })
    assert.equal(DEFAULT_CONFIG.liveSeconds, 120)
    assert.equal(DEFAULT_CONFIG.breakerDenials, 2)
    assert.equal(DEFAULT_CONFIG.breakerWindowSeconds, 60)
  })
})
