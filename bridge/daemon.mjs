#!/usr/bin/env node
// Office bridge daemon: one standalone process that owns ws://localhost:4777 for the visualizer
// and accepts events from every tool (opencode plugin, Cline hooks, Claude Code hooks).
//
//   POST /event   body: one OfficeEvent (without ts) or an array   -> {"ok":true}  (also marks its owner live)
//   POST /claim   {owner,source,path,...} write-lock a feature       -> 200 granted | 409 denied (holder, queuePosition)
//   POST /release {owner,feature?}                                   -> {"ok":true,"released":[...]}
//   POST /supersede {source,owner}  a new task/session started: drop idle same-source owners' locks -> {"ok":true,"superseded":[...]}
//   GET  /locks                                                      -> {"ok":true,"locks":[...],"waiters":[...]}
//   GET  /health                                                    -> {"ok":true,"clients":N,"locks":N}
//   WebSocket     visualizer subscribes; gets {type:"hello",replay} then live events
//
// OFFICE_COORDINATION overrides the coordination.json path (used by tests/demos with a private daemon).
// Zero dependencies (minimal RFC 6455 server -> client text frames). Port: OFFICE_BRIDGE_PORT (default 4777).
import { createServer } from "node:http"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { configLoader, createCoordinator } from "./coordinator.mjs"
import { clipMasked, maskDeep } from "./mask.mjs"

const PORT = Number(process.env.OFFICE_BRIDGE_PORT ?? 4777)
const REPLAY_LIMIT = 500
const REPLAY_BYTES = 600_000 // serialized size budget of the replay buffer; oldest events are evicted first
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

const replay = []
const replaySizes = []
let replayBytes = 0
const clients = new Set()
// eventId = <boot>-<seq>: unique per daemon run, seq strictly increasing (seq > 0 on the first replayed event = history dropped).
const BOOT36 = Date.now().toString(36)
let seq = 0

function frame(text) {
  const payload = Buffer.from(text)
  const len = payload.length
  const header =
    len < 126
      ? Buffer.from([0x81, len])
      : len < 65536
        ? Buffer.from([0x81, 126, len >> 8, len & 255])
        : Buffer.concat([Buffer.from([0x81, 127]), Buffer.alloc(4), Buffer.from([len >>> 24, (len >>> 16) & 255, (len >>> 8) & 255, len & 255])])
  return Buffer.concat([header, payload])
}

function send(socket, text) {
  if (socket.destroyed) return
  if (socket.writableLength > MAX_BUFFERED) return socket.destroy() // stalled client
  socket.write(frame(text))
}

function publish(input) {
  // ts/eventId are always daemon-assigned: producers cannot spoof ordering or identity.
  const event = { ...input, ts: Date.now(), eventId: `${BOOT36}-${seq++}` }
  const text = JSON.stringify(event)
  replay.push(event)
  replaySizes.push(Buffer.byteLength(text))
  replayBytes += replaySizes[replaySizes.length - 1]
  while (replay.length > 1 && (replay.length > REPLAY_LIMIT || replayBytes > REPLAY_BYTES)) {
    replay.shift()
    replayBytes -= replaySizes.shift()
  }
  for (const socket of clients) send(socket, text)
}

const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`])
const ALLOWED_ORIGINS = new Set(
  ["http://localhost:5173", "http://127.0.0.1:5173", process.env.OFFICE_VISUALIZER_ORIGIN].filter(Boolean),
)
const MAX_BODY = 64_000
const MAX_FIELD = 200
const MAX_BUFFERED = 1_000_000

const hostOk = (req) => ALLOWED_HOSTS.has(String(req.headers.host ?? "").toLowerCase())
// Hook clients (Node fetch) send no Origin; browsers always do, so a present Origin must be allowlisted.
const originOk = (req) => req.headers.origin === undefined || ALLOWED_ORIGINS.has(req.headers.origin)
const cors = (req) => (req.headers.origin && ALLOWED_ORIGINS.has(req.headers.origin) ? { "access-control-allow-origin": req.headers.origin, vary: "Origin" } : {})

const json = (req, res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", ...cors(req) })
  res.end(JSON.stringify(body))
}

const clip = (v) => (typeof v === "string" && v.length > MAX_FIELD ? v.slice(0, MAX_FIELD) : v)
/** Like clip, but masks first. Ids used for linking/locks (sessionID, owner, waitingOn.sessionID) stay on plain clip. */
const mclip = (v) => (typeof v === "string" && v !== "" ? clipMasked(v, MAX_FIELD) : v)
const clipWaiting = (w) => (w && typeof w === "object" ? { source: mclip(w.source), sessionID: clip(w.sessionID), feature: mclip(w.feature) } : undefined)
const MAX_LONG = 4000 // prompt / result
const MAX_ERROR = 1000
const MAX_DURATION_MS = 86_400_000
/** Optional string: masked then clipped; anything else is dropped. */
const opt = (v, n = MAX_FIELD) => (typeof v === "string" ? clipMasked(v, n) : undefined)
const duration = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_DURATION_MS ? v : undefined)
// Unknown/extra fields pass through, but masked (maskDeep keeps the routing-id exemptions); known fields override below.
const sanitize = (e) => ({
  ...maskDeep(e),
  agent: mclip(e.agent),
  sessionID: clip(e.sessionID),
  owner: clip(e.owner),
  reason: typeof e.reason === "string" ? opt(e.reason) ?? "" : e.reason,
  text: typeof e.text === "string" ? opt(e.text) ?? "" : e.text,
  target: mclip(e.target),
  source: mclip(e.source),
  priority: mclip(e.priority),
  phase: mclip(e.phase),
  feature: mclip(e.feature),
  waitingOn: clipWaiting(e.waitingOn),
  // Agent Interaction Viewer fields (all optional).
  prompt: opt(e.prompt, MAX_LONG),
  result: opt(e.result, MAX_LONG),
  error: opt(e.error, MAX_ERROR),
  correlationId: opt(e.correlationId),
  requestedAgent: opt(e.requestedAgent),
  toolName: opt(e.toolName),
  childSessionID: opt(e.childSessionID),
  status: opt(e.status),
  durationMs: duration(e.durationMs),
  // Hermes Agent OS correlation: one Hermes task -> executions across hermes and opencode events.
  taskId: opt(e.taskId),
  parentTaskId: opt(e.parentTaskId),
  executionId: opt(e.executionId),
  projectId: opt(e.projectId),
})

const coordinator = createCoordinator({
  config: configLoader(process.env.OFFICE_COORDINATION || join(dirname(fileURLToPath(import.meta.url)), "..", "coordination.json")),
  publish,
})
setInterval(() => coordinator.sweep(), 5000).unref()

/** Reads a JSON body (415/413/400 guarded) and calls cb(parsed); cb may throw -> 400. */
function readJson(req, res, cb) {
  if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    return json(req, res, 415, { ok: false })
  }
  const chunks = []
  let size = 0
  let tooBig = false
  req.on("data", (c) => {
    if (tooBig) return
    size += c.length
    if (size > MAX_BODY) {
      tooBig = true
      chunks.length = 0
      json(req, res, 413, { ok: false })
      return
    }
    chunks.push(c)
  })
  req.on("end", () => {
    if (tooBig) return
    try {
      cb(JSON.parse(Buffer.concat(chunks).toString("utf8")))
    } catch {
      json(req, res, 400, { ok: false })
    }
  })
}

const str = (v) => (typeof v === "string" && v.length > 0 ? clip(v) : undefined)

const server = createServer((req, res) => {
  if (!hostOk(req) || !originOk(req)) return json(req, res, 403, { ok: false })
  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...cors(req), "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST" })
    return res.end()
  }
  if (req.method === "POST" && req.url === "/event") {
    return readJson(req, res, (parsed) => {
      for (const e of Array.isArray(parsed) ? parsed : [parsed]) {
        if (e && typeof e.type === "string" && typeof e.agent === "string") {
          const clean = sanitize(e)
          // Presence: owner key = what /claim uses (hook sessionID, or the plugin's explicit `owner`).
          const owner = str(clean.owner) ?? str(clean.sessionID)
          const source = str(clean.source)
          // First event of an unseen Cline task = a new task: supersede idle same-source owners.
          if (owner && coordinator.touch(owner, source) && source === "cline") coordinator.supersede({ source, owner })
          publish(clean)
        }
      }
      json(req, res, 200, { ok: true })
    })
  }
  if (req.method === "POST" && req.url === "/claim") {
    return readJson(req, res, (b) => {
      const owner = str(b?.owner)
      const source = str(b?.source)
      const path = typeof b?.path === "string" && b.path ? b.path.slice(0, 1000) : undefined
      if (!owner || !source || !path) return json(req, res, 400, { ok: false })
      const r = coordinator.claim({ owner, source, sessionID: str(b.sessionID), agent: str(b.agent) ?? "orchestrator", path, priority: str(b.priority), phase: str(b.phase) })
      const { granted, ...rest } = r
      json(req, res, granted ? 200 : 409, { ok: true, granted, ...rest })
    })
  }
  if (req.method === "POST" && req.url === "/release") {
    return readJson(req, res, (b) => {
      const owner = str(b?.owner)
      if (!owner) return json(req, res, 400, { ok: false })
      json(req, res, 200, { ok: true, ...coordinator.release({ owner, feature: str(b.feature) }) })
    })
  }
  if (req.method === "POST" && req.url === "/supersede") {
    return readJson(req, res, (b) => {
      const owner = str(b?.owner)
      const source = str(b?.source)
      if (!owner || !source) return json(req, res, 400, { ok: false })
      json(req, res, 200, { ok: true, ...coordinator.supersede({ source, owner }) })
    })
  }
  if (req.method === "GET" && req.url === "/locks") return json(req, res, 200, { ok: true, ...coordinator.snapshot() })
  if (req.url === "/health") return json(req, res, 200, { ok: true, clients: clients.size, replay: replay.length, replayBytes, locks: coordinator.snapshot().locks.length })
  res.writeHead(200, cors(req))
  res.end("office-bridge ok")
})

server.on("upgrade", (req, socket) => {
  // The upgraded socket has no error listener of its own: a client reset (ECONNRESET) must not kill the daemon.
  socket.on("error", () => clients.delete(socket))
  if (!hostOk(req) || !originOk(req)) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
    return
  }
  const key = req.headers["sec-websocket-key"]
  if (!key) return socket.destroy()
  const accept = createHash("sha1").update(key + GUID).digest("base64")
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
  clients.add(socket)
  send(socket, JSON.stringify({ type: "hello", replay }))
  const drop = () => clients.delete(socket)
  socket.on("close", drop)
  // Client frames are only pings/close: answer close, ignore the rest.
  socket.on("data", (buf) => {
    const op = buf[0] & 0x0f
    if (op === 0x8) socket.end(Buffer.from([0x88, 0]))
    else if (op === 0x9) socket.write(Buffer.from([0x8a, 0]))
  })
})

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") process.exit(0) // another daemon already owns the port
  console.error(err)
  process.exit(1)
})

server.listen(PORT, "127.0.0.1", () => console.log(`office-bridge daemon listening on :${PORT}`))
