// Per-feature write-lock coordinator (in-memory, pure: time and event sink are injected).
// Cline / OpenCode / Claude Code claim a feature before writing; waiters queue by priority, phase, age.
// Locks only matter when ANOTHER owner is live (any event/claim within liveSeconds): a tool alone is never
// denied and produces no lock.* events; a holder that went silent is taken over (lock.expired, reason stale);
// repeated denials of the same owner+feature are overridden (lock.override) by a circuit breaker.
//   const c = createCoordinator({ config, publish, now: Date.now })
import { readFileSync, statSync } from "node:fs"

export const DEFAULT_CONFIG = {
  enabled: true,
  ttlSeconds: 600,
  waiterTtlSeconds: 30,
  agingSeconds: 120,
  liveSeconds: 120,
  supersedeIdleSeconds: 10,
  breakerDenials: 2,
  breakerWindowSeconds: 60,
  maxWaitSeconds: { claude: 8, cline: 45, opencode: 20 },
  onConflict: { cline: "wait", claude: "deny", opencode: "deny" }, // cline: a deny would kill its whole run, so wait then proceed with a warning
  pollMs: 1000,
  priorityDefault: "normal",
  priorityRank: { high: 0, normal: 1, low: 2 },
  phaseOrder: ["slicing", "integration"],
  phaseDefault: "integration",
  phaseByAgent: { coder: "slicing", qa: "integration", reviewer: "integration", devops: "integration", documenter: "integration" },
  pathRules: [{ match: "^seedly_app/lib/features/([^/]+)/", feature: "$1" }],
  sharedPaths: ["^seedly_app/pubspec\\.(yaml|lock)$", "^seedly_app/lib/cores/router/", "^seedly_app/lib/cores/dependency/"],
}

/** Reads coordination.json, falling back to defaults when missing/invalid. Re-reads on mtime change. */
export function configLoader(file) {
  let mtime = -1
  let cfg = DEFAULT_CONFIG
  return () => {
    try {
      const m = statSync(file).mtimeMs
      if (m !== mtime) {
        mtime = m
        cfg = { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(file, "utf8")) }
      }
    } catch {
      mtime = -1
      cfg = DEFAULT_CONFIG
    }
    return cfg
  }
}

const MAX_FIELD = 200
const MAX_ENTRIES = 500

/** Maps a repo-relative path to a feature name ("_shared" for cross-cutting files) or null. Each regex is isolated. */
export function featureOf(path, config) {
  const p = String(path ?? "").replace(/\\/g, "/").replace(/^\.\//, "")
  for (const re of config?.sharedPaths ?? []) {
    try {
      if (new RegExp(re).test(p)) return "_shared"
    } catch {}
  }
  for (const r of config?.pathRules ?? []) {
    try {
      const m = new RegExp(r.match).exec(p)
      if (m) return String(r.feature).replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? "").slice(0, MAX_FIELD)
    } catch {}
  }
  return null
}

/** `config` may be an object or a () => object (hot reload). */
export function createCoordinator({ config, publish = () => {}, now = Date.now }) {
  const cfg = () => (typeof config === "function" ? config() : config) ?? DEFAULT_CONFIG
  const locks = new Map()
  const waiters = new Map()
  const presence = new Map() // owner -> { source, lastSeen }
  const denials = new Map() // `${owner}\0${feature}` -> { starts: number[], lastAt }

  const liveMs = (c) => (c.liveSeconds ?? 120) * 1000
  const isLive = (owner, t, c) => {
    const p = presence.get(owner)
    return !!p && p.lastSeen + liveMs(c) > t
  }
  const otherLive = (owner, t, c) => {
    for (const [o, p] of presence) if (o !== owner && p.lastSeen + liveMs(c) > t) return true
    return false
  }

  /** Records that `owner` was seen now (any event or claim). */
  function touch(owner, source, t = now()) {
    if (!owner) return false
    const fresh = !presence.has(owner)
    presence.delete(owner) // re-insert keeps Map order = oldest first
    presence.set(owner, { source, lastSeen: t })
    while (presence.size > MAX_ENTRIES) presence.delete(presence.keys().next().value)
    return fresh
  }

  const rank = (c, w, t) => {
    const base = c.priorityRank?.[w.priority] ?? c.priorityRank?.[c.priorityDefault] ?? 1
    const aged = Math.floor((t - w.enqueuedAt) / 1000 / (c.agingSeconds || 120))
    return Math.max(0, base - aged)
  }
  const queue = (c, feature, t) => {
    const order = c.phaseOrder ?? []
    const idx = (w) => {
      const i = order.indexOf(w.phase)
      return i < 0 ? order.length : i
    }
    // Waiters whose owner is no longer live must not keep a free lock reserved.
    return [...(waiters.get(feature)?.entries() ?? [])]
      .filter(([owner]) => isLive(owner, t, c))
      .map(([owner, w]) => ({ owner, ...w }))
      .sort((a, b) => rank(c, a, t) - rank(c, b, t) || idx(a) - idx(b) || a.enqueuedAt - b.enqueuedAt)
  }
  const dropWaiter = (feature, owner) => {
    const m = waiters.get(feature)
    if (!m) return
    m.delete(owner)
    if (!m.size) waiters.delete(feature)
  }

  /** Circuit breaker: true when this denial of owner+feature should be overridden. */
  function tripped(c, key, t) {
    const limit = c.breakerDenials ?? 2
    const win = (c.breakerWindowSeconds ?? 60) * 1000
    const d = denials.get(key) ?? { starts: [], lastAt: -Infinity }
    d.starts = d.starts.filter((s) => t - s <= win)
    // Polls of one waiting episode (spaced ~pollMs) count as a single denial.
    const same = d.starts.length > 0 && t - d.lastAt <= 2.5 * (c.pollMs ?? 1000)
    d.lastAt = t
    if (same) {
      denials.set(key, d)
      return false
    }
    if (d.starts.length >= limit) {
      denials.delete(key)
      return true
    }
    d.starts.push(t)
    denials.set(key, d)
    return false
  }

  function sweep() {
    const c = cfg()
    const t = now()
    for (const [feature, l] of locks) {
      if (l.expiresAt > t) continue
      locks.delete(feature)
      if (!l.silent) publish({ type: "lock.expired", agent: l.agent, sessionID: l.sessionID, source: l.source, feature })
    }
    const wttl = (c.waiterTtlSeconds ?? 30) * 1000
    for (const [feature, m] of waiters) {
      for (const [owner, w] of m) if (w.lastSeen + wttl <= t) m.delete(owner)
      if (!m.size) waiters.delete(feature)
    }
    const keep = (c.ttlSeconds ?? 600) * 1000
    for (const [o, p] of presence) if (p.lastSeen + keep <= t) presence.delete(o)
    const win = (c.breakerWindowSeconds ?? 60) * 1000
    for (const [k, d] of denials) if (t - d.lastAt > win) denials.delete(k)
  }

  /** Bounds the maps: evicts the lock closest to expiry / the stalest waiter. */
  function cap() {
    while (locks.size > MAX_ENTRIES) {
      let victim
      for (const [f, l] of locks) if (!victim || l.expiresAt < locks.get(victim).expiresAt) victim = f
      const l = locks.get(victim)
      locks.delete(victim)
      if (!l.silent) publish({ type: "lock.expired", agent: l.agent, sessionID: l.sessionID, source: l.source, feature: victim, reason: "evicted" })
    }
    let total = 0
    for (const m of waiters.values()) total += m.size
    while (total-- > MAX_ENTRIES) {
      let vf, vo, vs = Infinity
      for (const [f, m] of waiters) for (const [o, w] of m) if (w.lastSeen < vs) [vf, vo, vs] = [f, o, w.lastSeen]
      dropWaiter(vf, vo)
    }
  }

  function claim({ owner, source, sessionID, agent, path, priority, phase }) {
    const c = cfg()
    if (!c.enabled) return { granted: true, feature: null }
    const t = now()
    touch(owner, source, t) // every claim, including denied ones, proves the owner is alive
    const feature = featureOf(path, c)
    if (!feature) return { granted: true, feature: null }
    sweep()
    const ttl = (c.ttlSeconds ?? 600) * 1000
    const dkey = `${owner}\0${feature}`
    let held = locks.get(feature)
    if (held?.owner === owner) {
      held.expiresAt = t + ttl
      dropWaiter(feature, owner)
      denials.delete(dkey)
      return { granted: true, feature, expiresAt: held.expiresAt }
    }
    if (held && !isLive(held.owner, t, c)) {
      // Holder went silent (crashed / cancelled task): it no longer blocks anyone.
      locks.delete(feature)
      if (!held.silent) publish({ type: "lock.expired", agent: held.agent, sessionID: held.sessionID, source: held.source, feature, reason: "stale" })
      held = undefined
    }
    const solo = !otherLive(owner, t, c)
    if (!solo) {
      // A second tool is active: make other owners' silent locks visible now.
      for (const [f, l] of locks) {
        if (!l.silent || l.owner === owner || !isLive(l.owner, t, c)) continue
        l.silent = false
        publish({ type: "lock.acquired", agent: l.agent, sessionID: l.sessionID, source: l.source, feature: f })
      }
    }
    const grant = () => {
      dropWaiter(feature, owner)
      denials.delete(dkey)
      const l = { owner, source, sessionID, agent, acquiredAt: t, expiresAt: t + ttl, silent: solo }
      locks.set(feature, l)
      cap()
      if (!solo) publish({ type: "lock.acquired", agent, sessionID, source, feature })
      return { granted: true, feature, expiresAt: l.expiresAt }
    }
    if (solo) return grant() // nobody else alive: never wait, never queue
    const m = waiters.get(feature) ?? new Map()
    waiters.set(feature, m)
    const prev = m.get(owner)
    if (!held) {
      const q = queue(c, feature, t)
      if (!q.length || q[0].owner === owner) return grant()
    }
    const q0 = queue(c, feature, t)
    const blocker = held ?? q0[0]
    if (tripped(c, dkey, t)) {
      dropWaiter(feature, owner)
      publish({
        type: "lock.override",
        agent,
        sessionID,
        source,
        feature,
        waitingOn: { source: blocker?.source, sessionID: blocker?.sessionID, feature },
        text: `lock override: ${feature} (denied too often)`,
      })
      return { granted: true, feature, override: true, holder: { source: blocker?.source, sessionID: blocker?.sessionID, agent: blocker?.agent } }
    }
    m.set(owner, { source, sessionID, agent, priority: priority ?? c.priorityDefault, phase: phase ?? c.phaseDefault, enqueuedAt: prev?.enqueuedAt ?? t, lastSeen: t })
    cap()
    const q = queue(c, feature, t)
    const pos = q.findIndex((w) => w.owner === owner) + 1
    const retryAfterMs = c.pollMs ?? 1000
    if (!held) {
      // Free but reserved for the queue head: the caller waits behind it.
      const h = q[0]
      return { granted: false, feature, reason: "reserved", holder: { source: h.source, sessionID: h.sessionID, agent: h.agent }, queuePosition: pos, retryAfterMs }
    }
    if (!prev) {
      held.silent = false
      publish({ type: "lock.waiting", agent, sessionID, source, feature, waitingOn: { source: held.source, sessionID: held.sessionID, feature } })
    }
    return { granted: false, feature, reason: "held", holder: { source: held.source, sessionID: held.sessionID, agent: held.agent }, queuePosition: pos, retryAfterMs }
  }

  function release({ owner, feature }) {
    const released = []
    for (const [f, l] of [...locks]) {
      if (l.owner !== owner || (feature && f !== feature)) continue
      locks.delete(f)
      released.push(f)
      if (!l.silent) publish({ type: "lock.released", agent: l.agent, sessionID: l.sessionID, source: l.source, feature: f })
    }
    for (const f of [...waiters.keys()]) if (!feature || f === feature) dropWaiter(f, owner)
    for (const k of [...denials.keys()]) if (k.startsWith(`${owner}\0`) && (!feature || k.endsWith(`\0${feature}`))) denials.delete(k)
    return { released }
  }

  /**
   * A new task/session of `source` started as `owner`: drops locks, waiters and presence of OTHER owners of the same
   * source idle for more than supersedeIdleSeconds (their task crashed or was replaced). Recently active owners are kept.
   */
  function supersede({ source, owner }) {
    const c = cfg()
    const t = now()
    const idleMs = (c.supersedeIdleSeconds ?? 10) * 1000
    const gone = new Set()
    for (const [o, p] of presence) if (o !== owner && p.source === source && t - p.lastSeen > idleMs) gone.add(o)
    const superseded = []
    for (const [f, l] of [...locks]) {
      if (l.owner === owner || l.source !== source) continue
      if (presence.has(l.owner) && !gone.has(l.owner)) continue // recently active: a real concurrent task
      locks.delete(f)
      superseded.push(f)
      if (!l.silent) publish({ type: "lock.expired", agent: l.agent, sessionID: l.sessionID, source: l.source, feature: f, reason: "superseded" })
    }
    for (const o of gone) {
      for (const f of [...waiters.keys()]) dropWaiter(f, o)
      for (const k of [...denials.keys()]) if (k.startsWith(`${o}\0`)) denials.delete(k)
      presence.delete(o)
    }
    return { superseded }
  }

  function snapshot() {
    const c = cfg()
    const t = now()
    return {
      locks: [...locks].map(([feature, l]) => ({ feature, ...l })),
      waiters: [...waiters.keys()].flatMap((feature) =>
        queue(c, feature, t).map((w, i) => ({ feature, owner: w.owner, source: w.source, agent: w.agent, priority: w.priority, phase: w.phase, waitedMs: t - w.enqueuedAt, position: i + 1 })),
      ),
      owners: [...presence].map(([owner, p]) => ({ owner, source: p.source, lastSeenMs: t - p.lastSeen, live: isLive(owner, t, c) })),
    }
  }

  return { claim, release, supersede, snapshot, sweep, touch }
}
