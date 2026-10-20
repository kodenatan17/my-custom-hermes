// Shared client for the office bridge daemon: POST an event (auto-starting the daemon when it is down)
// and claim/release per-feature write locks (never spawns; fails open when the daemon is unreachable).
import { spawn } from "node:child_process"
import { statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { configLoader } from "./coordinator.mjs"
import { mask } from "./mask.mjs"

const PORT = Number(process.env.OFFICE_BRIDGE_PORT ?? 4777)
const BASE = `http://127.0.0.1:${PORT}`
const DAEMON = join(dirname(fileURLToPath(import.meta.url)), "daemon.mjs")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const POST_TIMEOUT_MS = 400
const NEGATIVE_CACHE_MS = 30_000 // no respawn attempts for this long after a spawn
const SPAWN_GUARD = join(tmpdir(), `office-bridge-spawn-${PORT}`)

async function post(event) {
  const res = await fetch(`${BASE}/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  })
  // A legacy in-process bridge answers 200 "office-bridge ok" but drops events: require our JSON ack.
  const body = await res.json().catch(() => null)
  return body?.ok === true
}

/** True when a spawn happened within the negative-cache window; otherwise claims the slot. */
function spawnBlocked() {
  try {
    if (Date.now() - statSync(SPAWN_GUARD).mtimeMs < NEGATIVE_CACHE_MS) return true
  } catch {}
  try {
    writeFileSync(SPAWN_GUARD, String(Date.now()))
  } catch {
    return true // cannot record the guard: do not risk a spawn storm
  }
  return false
}

/** After a confirmed start, shorten the guard to ~3s so a later crash can be recovered from. */
function spawnSucceeded() {
  try {
    const t = new Date(Date.now() - (NEGATIVE_CACHE_MS - 3000))
    utimesSync(SPAWN_GUARD, t, t)
  } catch {}
}

function startDaemon() {
  // Under opencode (Bun) process.execPath is the opencode binary, so use node from PATH.
  const node = process.env.OFFICE_NODE ?? (process.versions.bun ? "node" : process.execPath)
  const child = spawn(node, [DAEMON], { detached: true, stdio: "ignore" })
  child.on("error", () => {})
  child.unref()
}

/** Free-text fields masked by emit() as a backstop (producers mask too). */
const MASKED_FIELDS = ["text", "prompt", "result", "error", "reason"]

/** Sends one event. Never throws: visualization must not break the tool that triggers it. */
export async function emit(event) {
  if (process.env.OFFICE_BRIDGE === "off") return false
  try {
    if (event && typeof event === "object") {
      event = { ...event }
      for (const k of MASKED_FIELDS) if (typeof event[k] === "string") event[k] = mask(event[k])
    }
  } catch {}
  try {
    return await post(event) // false = port held by a non-daemon: never spawn over it
  } catch (err) {
    // Only "connection refused" means no daemon is running; timeouts/resets do not justify a spawn.
    if ((err?.cause?.code ?? err?.code) !== "ECONNREFUSED") return false
  }
  if (spawnBlocked()) return false
  try {
    startDaemon()
  } catch {
    return false
  }
  for (let i = 0; i < 5; i++) {
    await sleep(150)
    try {
      if (await post(event)) {
        spawnSucceeded()
        return true
      }
    } catch {}
  }
  return false
}

/** Masks BEFORE clipping: a secret cut at the boundary (e.g. `://user:pa…` with no `@`) would no longer match. */
export const truncate = (s, n = 60) => {
  const m = mask(s)
  return m.length > n ? m.slice(0, n - 1) + "…" : m
}
export const basename = (p) => (typeof p === "string" ? (p.split("/").pop() ?? p) : "")

// ---- write-lock client ----
const CLAIM_TIMEOUT_MS = 1500
const FAIL_OPEN = { granted: true, failOpen: true }
const loadCoordination = configLoader(join(dirname(DAEMON), "..", "coordination.json"))

/** Effective coordination config (defaults when coordination.json is missing/invalid). */
export const coordination = () => loadCoordination()

export const isWrite = (tool) => /^(edit|write|multiedit|applypatch|patch|apply_patch|editor|write_to_file|replace_in_file)$/i.test(String(tool ?? ""))

/** Repo-relative, forward-slash path; "" when outside root. */
export function relPath(p, root = process.cwd()) {
  if (typeof p !== "string" || !p) return ""
  const r = relative(root, p.startsWith("/") || /^[a-zA-Z]:/.test(p) ? p : join(root, p)).replace(/\\/g, "/")
  return r.startsWith("..") ? "" : r
}

async function call(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CLAIM_TIMEOUT_MS),
  })
  const json = await res.json().catch(() => null)
  return json?.ok === true ? json : null
}

/**
 * Claims the feature for req.path ({owner,source,sessionID,agent,path,priority,phase}), polling while held
 * up to maxWaitMs. Returns {granted:true[,failOpen|override]} or {granted:false,holder,queuePosition,feature}.
 */
export async function claim(req, maxWaitMs = 8000) {
  if (process.env.OFFICE_BRIDGE === "off") return FAIL_OPEN
  const start = Date.now()
  for (;;) {
    let r
    try {
      r = await call("/claim", req)
    } catch {
      return FAIL_OPEN // refused / timeout / reset: never block work on a dead daemon
    }
    if (!r) return FAIL_OPEN
    if (r.granted === true) return { granted: true, feature: r.feature, override: r.override === true, holder: r.holder, waitedMs: Date.now() - start }
    if (r.granted !== false) return FAIL_OPEN
    const wait = Number(r.retryAfterMs) > 0 ? Number(r.retryAfterMs) : 1000
    if (Date.now() - start + wait >= maxWaitMs) {
      return { granted: false, feature: r.feature, holder: r.holder, queuePosition: r.queuePosition, reason: r.reason, waitedMs: Date.now() - start }
    }
    await sleep(wait)
  }
}

/** Releases every lock (or one feature) held by req.owner. Never throws. */
export async function release(req) {
  if (process.env.OFFICE_BRIDGE === "off") return FAIL_OPEN
  try {
    return (await call("/release", req)) ?? FAIL_OPEN
  } catch {
    return FAIL_OPEN
  }
}

/** A new task/session of req.source started as req.owner: drops idle same-source owners' locks. Never throws. */
export async function supersede(req) {
  if (process.env.OFFICE_BRIDGE === "off") return FAIL_OPEN
  try {
    return (await call("/supersede", req)) ?? FAIL_OPEN
  } catch {
    return FAIL_OPEN
  }
}
