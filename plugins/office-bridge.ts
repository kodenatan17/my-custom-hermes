import { claim, coordination, emit as send, isWrite, relPath, release } from "../bridge/emit.mjs"
import { clipMasked, mask } from "../bridge/mask.mjs"

/**
 * Office bridge: forwards simplified agent activity to the 3D office visualizer
 * (.opencode/visualizer) via the shared bridge daemon (.opencode/bridge/daemon.mjs),
 * which the plugin auto-starts. Cline and Claude Code feed the same daemon through hooks.
 *
 * It also enforces per-feature write locks (tool.execute.before -> daemon /claim), shared with Cline and
 * Claude Code hooks; fails open when the daemon is unreachable.
 *
 * Targets the opencode v2 plugin API: `export default { id, setup(api) }`, tool hooks on `api.tool`,
 * and the `api.event.subscribe()` async stream (events carry their payload under `data`).
 *
 * Port: OFFICE_BRIDGE_PORT (default 4777). Set OFFICE_BRIDGE=off to disable.
 */

type OfficeEvent = {
  ts: number
  type:
    | "prompt" // user prompt received by an agent session
    | "dispatch" // an agent delegated a task to a subagent
    | "activity" // an agent is running a tool
    | "busy"
    | "idle"
    | "error"
    | "handback" // a child session finished and reported back to its parent
  agent: string
  sessionID: string
  source?: string
  owner?: string // lock-owner key (opencode:<root session>) so the daemon can track liveness
  target?: string // dispatch: the subagent receiving the task
  text?: string
  // Agent Interaction Viewer fields (optional, additive).
  prompt?: string
  childSessionID?: string
  correlationId?: string
  requestedAgent?: string
  toolName?: string
  status?: "ok" | "error" | "interrupted"
  error?: string
  durationMs?: number
}

const MAX_LONG = 4000

// Masks BEFORE clipping: a secret cut at the boundary would no longer match a mask pattern.
const truncate = (s: string, n = 60) => {
  const m = mask(s)
  return m.length > n ? m.slice(0, n - 1) + "…" : m
}
const basename = (p: unknown) => (typeof p === "string" ? p.split("/").pop() ?? p : "")

function describeTool(tool: string, input: Record<string, unknown>, title?: string): string {
  switch (tool) {
    case "read":
      return `read ${basename(input.filePath ?? input.path)}`
    case "edit":
    case "write":
      return `${tool} ${basename(input.filePath ?? input.path)}`
    case "bash":
      return `bash ${truncate(String(input.command ?? "").trim().split(/\s+/)[0] ?? "", 32)}`.trim() // binary only: args may hold secrets
    case "grep":
      return `grep "${truncate(String(input.pattern ?? ""), 32)}"`
    case "glob":
      return `glob ${truncate(String(input.pattern ?? ""), 40)}`
    case "list":
      return `list ${basename(input.path) || "."}`
    case "webfetch":
      try {
        return `fetch ${new URL(String(input.url)).host}`
      } catch {
        return "webfetch"
      }
    case "todowrite":
      return "update todo"
    default:
      return truncate(title || tool)
  }
}

type ToolHookInput = {
  tool: string
  sessionID: string
  agent?: string
  input?: Record<string, unknown>
  status?: "completed" | "error"
}

type BridgeEvent = { type: string; data?: Record<string, any> }

export default {
  id: "office-bridge",
  setup: async (api: any) => {
    if (process.env.OFFICE_BRIDGE === "off") return
    const directory: string = api.location?.directory ?? process.cwd()

    const sessionAgent = new Map<string, string>()
    const sessionParent = new Map<string, string>()
    const childStart = new Map<string, number>() // child sessionID -> dispatch/execution start (ms)
    // Events are posted in order; a failed post must never break the agent session.
    let queue: Promise<unknown> = Promise.resolve()

    const agentOf = (sessionID: string) =>
      sessionAgent.get(sessionID) ?? (sessionParent.has(sessionID) ? "subagent" : "orchestrator")

    // Child/subagent sessions share their root session's lock owner.
    const rootOf = (id: string) => {
      for (let i = 0; i < 20 && sessionParent.has(id); i++) id = sessionParent.get(id)!
      return id
    }

    const emit = (e: Omit<OfficeEvent, "ts">) => {
      queue = queue.then(() => send({ ...e, source: "opencode", owner: `opencode:${rootOf(e.sessionID)}` })).catch(() => {})
    }

    const releaseRoot = (sessionID: string) => {
      if (sessionParent.has(sessionID)) return // child idle must not release the shared owner
      void release({ owner: `opencode:${sessionID}` }).catch(() => {})
    }

    /** Paths a write tool touches: edit/write args, or file headers inside a patch body. */
    const writePaths = (args: Record<string, unknown> | undefined): string[] => {
      const a = args ?? {}
      const direct = [a.filePath, a.file_path, a.path].filter((x): x is string => typeof x === "string" && x !== "")
      if (direct.length) return direct
      const patch = String(a.patchText ?? a.patch ?? "")
      return [...patch.matchAll(/^\*\*\* (?:Update|Add) File:\s*(.+?)\s*$/gm)].map((m) => m[1])
    }

    await api.tool.hook("execute.before", async (call: ToolHookInput) => {
      if (call.agent) sessionAgent.set(call.sessionID, call.agent)
      emit({ type: "activity", agent: agentOf(call.sessionID), sessionID: call.sessionID, text: describeTool(call.tool, call.input ?? {}) })
      if (!isWrite(call.tool)) return
      let denial: string | undefined
      try {
        const cfg = coordination()
        const agent = agentOf(call.sessionID)
        const root = rootOf(call.sessionID)
        const maxWait = (cfg.maxWaitSeconds?.opencode ?? 20) * 1000
        const priority = process.env.SEEDLY_PRIORITY || cfg.priorityDefault
        const phase = process.env.SEEDLY_PHASE || cfg.phaseByAgent?.[agent] || cfg.phaseDefault
        for (const p of new Set(writePaths(call.input))) {
          const path = relPath(p, directory)
          if (!path) continue
          // Awaited directly (not via the ordered emit queue) so the tool call waits for the lock.
          const r = await claim({ owner: `opencode:${root}`, source: "opencode", sessionID: call.sessionID, agent, path, priority, phase }, maxWait)
          if (r.granted) continue
          const h = r.holder
          denial =
            `Feature \`${r.feature}\` is locked by ${h?.source ?? "another tool"} (session ${h?.sessionID ?? "unknown"}). ` +
            `Waited ${Math.round((r.waitedMs ?? 0) / 1000)}s. Retry this edit shortly, or work on another feature.`
          break
        }
      } catch {
        return // fail open
      }
      if (denial) throw new Error(denial)
    })

    await api.tool.hook("execute.after", (call: ToolHookInput) => {
      if (call.status === "error") emit({ type: "error", agent: agentOf(call.sessionID), sessionID: call.sessionID, text: truncate(`${call.tool} gagal`), toolName: call.tool })
    })

    /** A child session ended: report back to its parent (in addition to the unchanged idle/error event). */
    const handback = (sessionID: string, status: "ok" | "error" | "interrupted", error?: string) => {
      const parentID = sessionParent.get(sessionID)
      if (!parentID) return
      const started = childStart.get(sessionID)
      childStart.delete(sessionID)
      emit({
        type: "handback",
        agent: agentOf(sessionID),
        target: agentOf(parentID),
        sessionID,
        childSessionID: sessionID,
        correlationId: `opencode:${sessionID}`,
        status,
        ...(error ? { error: clipMasked(error, 1000) } : {}),
        ...(started !== undefined ? { durationMs: Date.now() - started } : {}),
      })
    }

    const handle = ({ type, data = {} }: BridgeEvent) => {
      switch (type) {
        case "session.created": {
          const { sessionID, parentID, agent } = data
          if (agent) sessionAgent.set(sessionID, agent)
          if (!parentID) break
          sessionParent.set(sessionID, parentID)
          const target = agentOf(sessionID)
          childStart.set(sessionID, Date.now())
          const link = {
            childSessionID: sessionID,
            correlationId: `opencode:${sessionID}`,
            ...(agent && agent !== target ? { requestedAgent: String(agent) } : {}),
          }
          emit({ type: "dispatch", agent: agentOf(parentID), target, sessionID: parentID, text: truncate(data.title ?? target), ...link })
          emit({ type: "busy", agent: target, sessionID, ...link })
          break
        }
        case "session.agent.selected":
          if (data.agent) sessionAgent.set(data.sessionID, data.agent)
          break
        case "session.step.started":
          if (data.agent && !sessionAgent.has(data.sessionID)) sessionAgent.set(data.sessionID, data.agent)
          break
        case "session.inbox.enqueued": {
          const text = String(data.item?.payload?.text ?? "").trim()
          if (data.item?.type === "user" && text)
            emit({ type: "prompt", agent: agentOf(data.sessionID), sessionID: data.sessionID, text: truncate(text, 80), prompt: clipMasked(text, MAX_LONG) })
          break
        }
        case "session.execution.started":
          emit({ type: "busy", agent: agentOf(data.sessionID), sessionID: data.sessionID })
          if (sessionParent.has(data.sessionID) && !childStart.has(data.sessionID)) childStart.set(data.sessionID, Date.now())
          break
        case "session.execution.succeeded":
        case "session.execution.interrupted":
          emit({ type: "idle", agent: agentOf(data.sessionID), sessionID: data.sessionID })
          releaseRoot(data.sessionID)
          handback(data.sessionID, type === "session.execution.succeeded" ? "ok" : "interrupted")
          break
        case "session.execution.failed":
          emit({ type: "error", agent: agentOf(data.sessionID), sessionID: data.sessionID, text: truncate(String(data.error?.message ?? data.error?.name ?? "error")) })
          releaseRoot(data.sessionID)
          handback(data.sessionID, "error", String(data.error?.message ?? data.error?.name ?? "error"))
          break
      }
    }

    // The stream runs for the lifetime of the server; a handler error must not end it.
    void (async () => {
      for await (const event of api.event.subscribe()) {
        try {
          handle(event as BridgeEvent)
        } catch {}
      }
    })().catch(() => {})
  },
}
