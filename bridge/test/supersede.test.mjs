import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { createCoordinator, DEFAULT_CONFIG } from "../coordinator.mjs"

const F = (n) => `seedly_app/lib/features/${n}/x.dart`
function setup(over = {}) {
  let t = 1_000_000
  const events = []
  const cfg = { ...DEFAULT_CONFIG, breakerDenials: 1e9, ...over }
  const c = createCoordinator({ config: cfg, publish: (e) => events.push(e), now: () => t })
  return { c, events, adv: (s) => (t += s * 1000) }
}
const cl = (owner, path, source) => ({ owner, source, sessionID: owner, agent: "orchestrator", path })

describe("same-source supersede", () => {
  test("dead T1 then new T2: supersede frees the lock at once, no denial", () => {
    const { c, events, adv } = setup()
    c.touch("cline:o", "other") // a live other tool makes locks non-silent
    assert.equal(c.claim(cl("cline:T1", F("garden"), "cline")).granted, true)
    adv(30) // T1 crashed; keep the other tool alive
    c.touch("cline:o", "other")
    const r = c.supersede({ source: "cline", owner: "cline:T2" })
    assert.deepEqual(r.superseded, ["garden"])
    const exp = events.filter((e) => e.type === "lock.expired")
    assert.equal(exp.length, 1)
    assert.equal(exp[0].reason, "superseded")
    assert.equal(c.claim(cl("cline:T2", F("garden"), "cline")).granted, true)
  })
  test("two concurrent live tasks of the same source still conflict", () => {
    const { c, adv } = setup()
    c.claim(cl("cline:T1", F("garden"), "cline"))
    adv(3)
    c.touch("cline:T1", "cline")
    adv(2)
    assert.deepEqual(c.supersede({ source: "cline", owner: "cline:T2" }).superseded, [])
    c.touch("cline:T2", "cline")
    assert.equal(c.claim(cl("cline:T2", F("garden"), "cline")).granted, false)
  })
  test("recently active older task (<supersedeIdleSeconds) is not superseded; other sources untouched", () => {
    const { c, adv } = setup()
    c.claim(cl("cline:T1", F("garden"), "cline"))
    c.claim(cl("claude:S", F("auth"), "claude"))
    adv(9)
    assert.deepEqual(c.supersede({ source: "cline", owner: "cline:T2" }).superseded, [])
    adv(5) // now idle 14s
    assert.deepEqual(c.supersede({ source: "cline", owner: "cline:T2" }).superseded, ["garden"])
    assert.equal(c.snapshot().locks.some((l) => l.feature === "auth"), true)
  })
  test("superseding drops the dead owner's waiters and presence (T2 is solo again)", () => {
    const { c, adv } = setup()
    c.claim(cl("claude:S", F("garden"), "claude"))
    c.claim(cl("cline:T1", F("garden"), "cline")) // waits
    adv(1)
    c.touch("claude:S", "claude")
    adv(20)
    c.touch("claude:S", "claude")
    c.supersede({ source: "cline", owner: "cline:T2" })
    assert.equal(c.snapshot().waiters.length, 0)
    assert.equal(c.snapshot().owners.some((o) => o.owner === "cline:T1"), false)
  })
})

describe("silent locks and dead waiters", () => {
  test("silent lock expiry, stale takeover and supersede emit no lock.expired", () => {
    const { c, events, adv } = setup({ ttlSeconds: 50, liveSeconds: 20 })
    c.claim(cl("cline:A", F("garden"), "cline")) // solo => silent
    adv(30)
    c.claim(cl("cline:C", F("garden"), "cline")) // stale takeover of silent A (A dead, C solo again)
    c.claim(cl("cline:C", F("auth"), "cline"))
    adv(15)
    c.supersede({ source: "cline", owner: "cline:D" }) // supersedes silent C locks
    c.claim(cl("cline:D", F("home"), "cline"))
    adv(100)
    c.sweep() // ttl expiry of silent D lock
    assert.equal(events.filter((e) => String(e.type).startsWith("lock.")).length, 0)
  })
  test("a non-live waiter does not keep a free lock reserved", () => {
    const { c, adv } = setup({ liveSeconds: 20, waiterTtlSeconds: 1000 })
    c.claim(cl("a", F("garden"), "claude"))
    c.claim(cl("w", F("garden"), "cline")) // waits behind a
    c.claim(cl("a", F("auth"), "claude"))
    c.release({ owner: "a", feature: "garden" })
    adv(10)
    c.touch("a", "claude")
    adv(15) // w last seen 25s ago: dead; a still live
    c.touch("a", "claude")
    const r = c.claim(cl("x", F("garden"), "opencode"))
    assert.equal(r.granted, true)
  })
})
