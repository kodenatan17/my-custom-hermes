// QA adversarial probes for solo mode / liveness / circuit breaker (realistic liveSeconds=120, breaker on).
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { createCoordinator, DEFAULT_CONFIG } from "../coordinator.mjs"

const F = (n) => `seedly_app/lib/features/${n}/x.dart`
function setup(over = {}) {
  let t = 1_000_000
  const events = []
  const c = createCoordinator({ config: { ...DEFAULT_CONFIG, ...over }, publish: (e) => events.push(e), now: () => t })
  return { c, events, adv: (s) => (t += s * 1000), time: () => t }
}
const cl = (owner, path, o = {}) => ({ owner, source: o.source ?? owner.split(":")[0], sessionID: owner, agent: "orchestrator", path, ...o })

describe("QA solo", () => {
  test("1 solo owner: many features, always granted, no waiters, no events", () => {
    const { c, events, adv } = setup()
    for (let i = 0; i < 300; i++) {
      adv(1)
      const r = c.claim(cl("cline:a", F("f" + (i % 40))))
      assert.equal(r.granted, true)
    }
    assert.equal(c.claim(cl("cline:a", "seedly_app/pubspec.yaml")).granted, true)
    assert.equal(c.snapshot().waiters.length, 0)
    assert.equal(events.filter((e) => e.type.startsWith("lock.")).length, 0)
  })
  test("1b solo owner reclaims after other owner went stale: still no events", () => {
    const { c, events, adv } = setup()
    c.claim(cl("claude:x", F("a"))); adv(130)
    assert.equal(c.claim(cl("cline:y", F("a"))).granted, true)
    assert.equal(c.snapshot().waiters.length, 0)
    assert.ok(events.every((e) => e.type === "lock.expired" && e.reason === "stale") || events.length === 0)
  })
})

describe("QA liveness", () => {
  test("2 second owner appears: lock visible, newcomer waits only if holder live", () => {
    const { c, events, adv } = setup()
    c.claim(cl("claude:a", F("g"))); assert.equal(events.length, 0)
    adv(10)
    const r = c.claim(cl("cline:b", F("g")))
    assert.equal(r.granted, false)
    assert.ok(events.some((e) => e.type === "lock.acquired" && e.source === "claude"), "silent lock made visible")
    assert.equal(c.snapshot().locks[0].silent, false)
  })
  test("2b holder idle > liveSeconds => takeover with stale expiry", () => {
    const { c, events, adv } = setup()
    c.touch("cline:z", "cline") // makes the lock visible (non-silent)
    c.claim(cl("claude:a", F("g"))); adv(121)
    const r = c.claim(cl("cline:b", F("g")))
    assert.equal(r.granted, true)
    assert.equal(events.filter((e) => e.type === "lock.expired" && e.reason === "stale").length, 1)
    assert.equal(c.snapshot().waiters.length, 0)
  })
  test("2c boundary: exactly liveSeconds idle is stale (lastSeen+live > t strict)", () => {
    const { c, adv } = setup()
    c.claim(cl("claude:a", F("g"))); adv(120)
    assert.equal(c.claim(cl("cline:b", F("g"))).granted, true)
  })
})

describe("QA user failure mode: dead cline:old holds garden", () => {
  test("3 cline:new at +10,+60,+125 (poll-spaced episodes)", () => {
    const { c, events, adv, time } = setup()
    const t0 = time()
    c.claim(cl("cline:old", F("garden")))
    const out = []
    const episode = (atSec) => {
      const target = t0 + atSec * 1000
      adv((target - time()) / 1000)
      // hook polls at +0,+1,+2s (maxWait 3s)
      const rs = [0, 1, 2].map((i) => { if (i) adv(1); return c.claim(cl("cline:new", F("garden"))) })
      out.push({ atSec, granted: rs.map((r) => r.granted), override: rs.map((r) => !!r.override) })
    }
    episode(10); episode(60); episode(125)
    console.log("SCENARIO3", JSON.stringify(out), "events", events.map((e) => e.type + (e.reason ? ":" + e.reason : "")).join(","))
    assert.deepEqual(out[0].granted, [false, false, false])
    assert.deepEqual(out[1].granted, [false, false, false])
    assert.deepEqual(out[2].granted, [true, true, true])
  })
  test("3b fast retries (+10,+20,+30) => breaker overrides 3rd episode; lock stays with holder", () => {
    const { c, events, adv } = setup()
    c.claim(cl("cline:old", F("garden"))); adv(10)
    const r = []
    for (let i = 0; i < 3; i++) { r.push(c.claim(cl("cline:new", F("garden")))); adv(10) }
    assert.deepEqual(r.map((x) => x.granted), [false, false, true])
    assert.equal(r[2].override, true)
    assert.equal(c.snapshot().locks[0].owner, "cline:old")
    assert.equal(events.filter((e) => e.type === "lock.override").length, 1)
  })
})

describe("QA breaker semantics", () => {
  test("5 polls within one episode count once; override emitted once per episode not per poll", () => {
    const { c, events, adv } = setup()
    c.claim(cl("claude:a", F("g"))); adv(1)
    // keep holder live
    const hold = () => c.touch("claude:a", "claude")
    const claimB = () => { hold(); return c.claim(cl("cline:b", F("g"))) }
    for (let i = 0; i < 10; i++) { assert.equal(claimB().granted, false); adv(1) } // one long episode
    adv(5) // gap > 2.5s => new episode 2
    assert.equal(claimB().granted, false); adv(5)
    const r3 = claimB(); assert.equal(r3.override, true)
    assert.equal(events.filter((e) => e.type === "lock.override").length, 1)
    // counter reset after override: next episode denied again
    adv(5); assert.equal(claimB().granted, false)
  })
  test("5b grant resets the counter; release resets the counter", () => {
    const { c, adv } = setup()
    c.claim(cl("claude:a", F("g"))); adv(1)
    const keep = () => c.touch("claude:a", "claude")
    keep(); c.claim(cl("cline:b", F("g"))); adv(5); keep(); c.claim(cl("cline:b", F("g"))); adv(5)
    c.release({ owner: "claude:a" }); keep()
    assert.equal(c.claim(cl("cline:b", F("g"))).granted, true) // granted -> denials cleared
    c.release({ owner: "cline:b" })
    c.claim(cl("claude:a", F("g"))); adv(5)
    assert.equal(c.claim(cl("cline:b", F("g"))).granted, false) // episode 1 again, not override
  })
  test("5c override never steals: other owner's claim still held by original", () => {
    const { c, adv } = setup()
    c.claim(cl("claude:a", F("g")))
    for (let i = 0; i < 3; i++) { adv(5); c.touch("claude:a", "claude"); c.claim(cl("cline:b", F("g"))) }
    assert.equal(c.snapshot().locks.find((l) => l.feature === "g").owner, "claude:a")
  })
})

describe("QA caps", () => {
  test("6 600 features by solo owner: no crash, <=500 locks; live holder with fresh lock may be evicted only by expiry order", () => {
    const { c, adv } = setup()
    for (let i = 0; i < 600; i++) { adv(0.01); c.claim(cl("claude:a", F("f" + i))) }
    assert.ok(c.snapshot().locks.length <= 500)
  })
  test("6b 700 waiters across features no crash", () => {
    const { c, adv } = setup()
    c.claim(cl("claude:a", "seedly_app/pubspec.yaml"))
    for (let i = 0; i < 700; i++) { adv(0.001); c.touch("claude:a", "claude"); c.claim(cl("cline:w" + i, "seedly_app/pubspec.yaml")) }
    assert.ok(c.snapshot().waiters.length <= 500)
    assert.equal(c.snapshot().locks[0].owner, "claude:a")
  })
  test("6c presence cap 500: live holder's presence evicted by 600 touchers => holder looks dead?", () => {
    const { c, adv } = setup()
    c.claim(cl("claude:a", F("g")))
    for (let i = 0; i < 600; i++) { adv(0.01); c.touch("x" + i, "cline") }
    const r = c.claim(cl("cline:b", F("g")))
    console.log("PRESENCE_EVICT holder live-evicted => granted:", r.granted)
  })
  test("6d shared paths", () => {
    const { c } = setup()
    c.claim(cl("claude:a", "seedly_app/pubspec.yaml")); c.touch("cline:b", "cline")
    for (const p of ["seedly_app/pubspec.lock", "seedly_app/lib/cores/router/app_router.dart", "seedly_app/lib/cores/dependency/injection.dart"]) {
      assert.equal(c.claim(cl("cline:b", p)).feature, "_shared")
    }
  })
})

describe("QA regression with live owners", () => {
  test("8 priority/phase/aging/queue ordering works with liveSeconds=120", () => {
    const { c, adv } = setup({ breakerDenials: 1e9 })
    c.claim(cl("claude:h", F("g")))
    const live = () => ["claude:h", "w1", "w2", "w3"].forEach((o) => c.touch(o, "x"))
    adv(1); live(); c.claim(cl("w1", F("g"), { priority: "low", source: "cline" }))
    adv(1); live(); c.claim(cl("w2", F("g"), { priority: "high", source: "cline" }))
    adv(1); live(); c.claim(cl("w3", F("g"), { priority: "normal", source: "cline" }))
    const snap = c.snapshot().waiters.map((w) => w.owner)
    assert.deepEqual(snap, ["w2", "w3", "w1"])
    c.release({ owner: "claude:h" }); live()
    assert.equal(c.claim(cl("w1", F("g"), { priority: "low", source: "cline" })).granted, false) // w2 first
    assert.equal(c.claim(cl("w2", F("g"), { priority: "high", source: "cline" })).granted, true)
  })
  test("8b phase: slicing before integration at equal priority", () => {
    const { c, adv } = setup({ breakerDenials: 1e9 })
    c.claim(cl("claude:h", F("g")))
    const live = () => ["claude:h", "i", "s"].forEach((o) => c.touch(o, "x"))
    adv(1); live(); c.claim(cl("i", F("g"), { phase: "integration", source: "cline" }))
    adv(1); live(); c.claim(cl("s", F("g"), { phase: "slicing", source: "cline" }))
    assert.deepEqual(c.snapshot().waiters.map((w) => w.owner), ["s", "i"])
  })
  test("8c TTL 600 upper bound: holder kept live by touch still expires at 600s", () => {
    const { c, events, adv } = setup()
    c.touch("cline:o", "cline")
    c.claim(cl("claude:h", F("g")))
    for (let i = 0; i < 61; i++) { adv(10); c.touch("claude:h", "claude"); c.touch("cline:o", "cline") }
    assert.equal(c.claim(cl("cline:o", F("g"))).granted, true)
    assert.ok(events.some((e) => e.type === "lock.expired"))
  })
})

describe("QA edge: dead queue head", () => {
  test("9 free lock reserved for a dead waiter blocks live owner (<=30s waiterTtl)", () => {
    const { c, adv } = setup({ breakerDenials: 1e9 })
    c.claim(cl("claude:h", F("g")))
    adv(1); c.claim(cl("cline:dead", F("g"))) // waiter, then dies
    adv(1); c.release({ owner: "claude:h" })
    c.touch("claude:z", "claude")
    const r = c.claim(cl("claude:z", F("g"), { priority: "low" }))
    console.log("DEAD_HEAD reserved-for-dead-waiter result:", r.granted, r.reason)
  })
})
