#!/usr/bin/env node
// Hook adapter: turns Cline / Claude Code hook payloads (JSON on stdin) into office events.
//   bash hook.sh cline     <- .clinerules/hooks/<Event>  (launcher; also .claude/settings.json with `claude`)
//   node hook.mjs claude   <- direct invocation (tests); .claude/settings.json uses `bash hook.sh claude`
// Always exits 0. Observability, plus write-lock enforcement: a write tool (edit/write/patch) on a feature
// held by another tool is claimed first and, per `onConflict` in coordination.json, either DENIED after the wait
// budget (claude) or waited on and then let through with a warning (cline: a Cline deny kills the whole run).
// Any hook failure or unreachable daemon fails open: the tool is never blocked by infrastructure trouble.
import { appendFileSync, readdirSync, renameSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { basename, claim, coordination, emit, isWrite, release, relPath, supersede, truncate } from "./emit.mjs"
import { clipMasked } from "./mask.mjs"

const source = process.argv[2]
const startedAt = Date.now()
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const agentsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "agents")
let roster = new Set()
try {
  roster = new Set(readdirSync(agentsDir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)))
} catch {}

// Best-effort decision log (JSONL) so hook behavior can be proven, not guessed. Never throws.
const LOG = process.env.OFFICE_HOOK_LOG || join(dirname(fileURLToPath(import.meta.url)), "hook.log")
const LOG_MAX = 512 * 1024
function logLine(entry) {
  if (process.env.OFFICE_BRIDGE === "off") return
  try {
    try {
      if (statSync(LOG).size > LOG_MAX) renameSync(LOG, `${LOG}.1`)
    } catch {}
    appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), source, ...entry }) + "\n")
  } catch {}
}
let logCtx = {}

const stdin = await new Promise((resolve) => {
  let data = ""
  process.stdin.on("data", (c) => (data += c))
  process.stdin.on("end", () => resolve(data))
  setTimeout(() => resolve(data), 2000)
})

let p = {}
try {
  p = JSON.parse(stdin)
} catch {}

/** Best-effort one-line description of a tool call across the two tools' naming schemes. */
function describe(tool, input) {
  const i = input && typeof input === "object" ? input : {}
  const path = i.file_path ?? i.filePath ?? i.path ?? (Array.isArray(i.files) ? i.files[0] : undefined)
  const t = String(tool ?? "tool")
  const key = t.toLowerCase()
  if (/^(read|readfile)$/.test(key)) return `read ${basename(path)}`
  if (/^(edit|write|multiedit|editor|applypatch|notebookedit)$/.test(key)) return `${key === "applypatch" ? "patch" : "edit"} ${basename(path) || ""}`.trim()
  if (/^(bash|shell|execute_command)$/.test(key)) return `bash ${truncate(String(i.command ?? i.cmd ?? "").trim().split(/\s+/)[0] ?? "", 32)}`.trim() // binary only: args may hold secrets
  if (/^(grep|search|search_files)$/.test(key)) return `grep "${truncate(String(i.pattern ?? i.query ?? i.regex ?? ""), 32)}"`
  if (key === "glob") return `glob ${truncate(String(i.pattern ?? ""), 40)}`
  if (/^(webfetch|websearch)$/.test(key)) {
    try {
      return `fetch ${new URL(String(i.url)).host}`
    } catch {
      return truncate(String(i.query ?? key))
    }
  }
  if (key === "skills" || key === "skill") return `skill ${truncate(String(i.name ?? i.skill ?? ""), 32)}`.trim()
  if (key === "todowrite") return "update todo"
  if (key === "askquestion") return "asks a question"
  if (key === "submit") return "submits result"
  return truncate(t)
}

// Hook result. Cline reads {cancel} from stdout; Claude Code reads a PreToolUse permissionDecision.
let result = source === "cline" ? { cancel: false } : null

/**
 * Claude Code's "deny this tool call" schema (a tool error the model can read and retry).
 * Cline has NO deny: a tool_call hook answering {cancel:true} becomes a runtime stop (ControlledStopError) that
 * HALTS THE WHOLE RUN and the reason never reaches the model (verified in extension 4.1.21/4.1.22 dist). So for
 * Cline a conflict waits, then proceeds with a warning (`context`, injected only when cancel is not true).
 */
function deny(reason) {
  if (source === "cline") return // invariant: this hook never prints cancel:true
  result = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }
}

/** Claims every path of a write tool call; returns true when the call may proceed. */
async function claimWrites(tool, input, { owner, sessionID, agent }) {
  if (!isWrite(tool)) return true
  const i = input && typeof input === "object" ? input : {}
  const raw = [i.file_path, i.filePath, i.path, ...(Array.isArray(i.files) ? i.files : [])].filter((x) => typeof x === "string" && x)
  const cfg = coordination()
  const priority = process.env.SEEDLY_PRIORITY || cfg.priorityDefault
  const phase = process.env.SEEDLY_PHASE || cfg.phaseByAgent?.[agent] || cfg.phaseDefault
  const envRaw = process.env.OFFICE_MAX_WAIT_SECONDS // test/ops override of the per-source budget
  const envWait = envRaw === undefined || envRaw === "" ? NaN : Number(envRaw)
  const maxWait = (envWait >= 0 ? envWait : (cfg.maxWaitSeconds?.[source] ?? 8)) * 1000
  // Cline can only wait-then-proceed (a deny would kill its run), whatever the config says.
  const waitMode = source === "cline" || cfg.onConflict?.[source] === "wait"
  // One wait budget for the whole hook invocation, counted from process start (stdin read + emits included).
  const budgetStart = startedAt
  const warnings = []
  for (const p of new Set(raw)) {
    const path = relPath(p, root)
    if (!path) continue
    const remaining = Math.max(0, maxWait - (Date.now() - budgetStart))
    const r = await claim({ owner, source, sessionID, agent, path, priority, phase }, remaining)
    const decision = r.granted ? (r.failOpen ? "failopen" : r.override ? "override" : "granted") : waitMode ? "override" : "denied"
    logLine({ kind: "claim", hookName: logCtx.hookName, tool, path, decision, waitedMs: r.waitedMs ?? 0 })
    if (r.granted) continue
    const h = r.holder ?? {}
    if (waitMode) {
      // Wait budget expired with the holder still live: proceed (never cancel) and tell the model + visualizer.
      await emit({
        type: "lock.override",
        agent,
        sessionID,
        source,
        feature: r.feature,
        waitingOn: { source: h.source, sessionID: h.sessionID, feature: r.feature },
        text: truncate(`lock override: ${r.feature} (wait expired)`, 80),
        reason: "wait-expired",
      })
      warnings.push(
        `Warning: feature \`${r.feature}\` is being edited by ${h.source ?? "another tool"} (session ${h.sessionID ?? "unknown"}) after waiting ${Math.round((r.waitedMs ?? 0) / 1000)}s; ` +
          `finish quickly and avoid overlapping edits.`,
      )
      continue
    }
    deny(
      `Feature \`${r.feature}\` is locked by ${h.source ?? "another tool"} (session ${h.sessionID ?? "unknown"}). ` +
        `Waited ${Math.round((r.waitedMs ?? 0) / 1000)}s. Retry this edit shortly, or work on another feature.`,
    )
    return false
  }
  if (warnings.length) result = { cancel: false, context: warnings.join(" ") }
  return true
}

const tag = (text) => truncate(`${source}: ${text}`, 80)
const MAX_LONG = 4000

/** Plain text of a Task/Agent tool_response: a string, content blocks, or an object carrying either. */
function responseText(r) {
  if (typeof r === "string") return r
  const blocks = Array.isArray(r) ? r : Array.isArray(r?.content) ? r.content : null
  if (blocks) return blocks.map((b) => (typeof b === "string" ? b : typeof b?.text === "string" ? b.text : "")).filter(Boolean).join("\n")
  if (typeof r?.content === "string") return r.content
  if (typeof r?.result === "string") return r.result
  return undefined
}

// Cline SDK hook names (payload.hookName) -> the legacy script/event names this adapter switches on.
const CLINE_SDK_EVENTS = {
  agent_start: "TaskStart",
  agent_resume: "TaskResume",
  agent_end: "TaskComplete",
  agent_abort: "TaskCancel",
  agent_error: "TaskError",
  tool_call: "PreToolUse",
  tool_result: "PostToolUse",
  prompt_submit: "UserPromptSubmit",
  session_shutdown: "TaskCancel", // releases locks like a cancel
}

/**
 * Cline 4.1.x runs scripts named after the legacy events (PreToolUse.sh ...) but the stdin payload's `hookName`
 * carries the SDK name (tool_call ...). Prefer the event the script passes as argv[3]; else map hookName.
 */
function clineEvent() {
  const given = process.argv[3]
  if (given) return CLINE_SDK_EVENTS[given] ?? given
  return CLINE_SDK_EVENTS[p.hookName] ?? p.hookName
}

async function cline() {
  const event = clineEvent()
  const main = !p.parent_agent_id
  const agent = main ? "orchestrator" : "scout" // Cline sub-agents are research helpers
  const sessionID = `cline:${p.taskId ?? "task"}`
  const base = { agent, sessionID, source }
  logCtx = { hookName: event, tool: p.tool_call?.name ?? p.preToolUse?.toolName }
  switch (event) {
    case "UserPromptSubmit": {
      const raw = String(p.userPromptSubmit?.prompt ?? "")
      return emit({ type: "prompt", ...base, text: tag(raw.replace(/\s+/g, " ").trim()), prompt: clipMasked(raw, MAX_LONG) })
    }
    case "TaskStart":
    case "TaskResume":
      await supersede({ owner: sessionID, source })
      return emit({ type: "busy", ...base, text: tag("task started") })
    case "PreToolUse": {
      const tool = p.tool_call?.name ?? p.preToolUse?.toolName
      const input = p.tool_call?.input ?? p.preToolUse?.parameters
      if (!(await claimWrites(tool, input, { owner: sessionID, sessionID, agent }))) return
      return emit({ type: "activity", ...base, text: describe(tool, input) })
    }
    case "PostToolUse":
      // Payload (extension source): tool_result{id,name,input,output,error?} + postToolUse{toolName,success=!error,...}.
      if (p.postToolUse?.success === false || p.tool_result?.error || p.tool_result?.isError === true || p.success === false) {
        const toolName = p.postToolUse?.toolName ?? p.tool_result?.name ?? "tool"
        return emit({ type: "error", ...base, text: truncate(`${toolName} gagal`), toolName })
      }
      return
    case "TaskComplete":
    case "TaskCancel":
      await release({ owner: sessionID })
      return emit({ type: "idle", ...base })
    case "TaskError":
      await release({ owner: sessionID })
      return emit({ type: "error", ...base, text: truncate(String(p.error?.message ?? p.error ?? "error")) })
  }
}

/** Roster target of a Task/Agent call; requestedAgent = the raw subagent_type when it was relabelled. */
function taskTarget(input) {
  const requested = String(input?.subagent_type ?? "")
  const target = roster.has(requested) ? requested : "scout"
  return { target, requestedAgent: requested && requested !== target ? requested : undefined }
}

async function claude() {
  const sessionID = `claude:${p.session_id ?? "session"}`
  const sub = typeof p.agent_type === "string" ? p.agent_type : undefined
  const agent = sub ? (roster.has(sub) ? sub : "scout") : "orchestrator"
  const base = { agent, sessionID, source }
  logCtx = { hookName: p.hook_event_name, tool: p.tool_name }
  const isTask = p.tool_name === "Task" || p.tool_name === "Agent"
  const correlationId = typeof p.tool_use_id === "string" && p.tool_use_id ? `claude:${p.tool_use_id}` : undefined
  const task = isTask ? taskTarget(p.tool_input) : {}
  switch (p.hook_event_name) {
    case "UserPromptSubmit": {
      // Harness-injected turns (subagent hand-backs, notifications) are not user prompts.
      if (/^\s*<(agent-message|task-notification|system-reminder)/.test(String(p.prompt ?? ""))) return
      const raw = String(p.prompt ?? "")
      return emit({ type: "prompt", ...base, text: tag(raw.replace(/\s+/g, " ").trim()), prompt: clipMasked(raw, MAX_LONG) })
    }
    case "SessionStart":
      await supersede({ owner: sessionID, source })
      return emit({ type: "busy", ...base, text: tag("session started") })
    case "PreToolUse": {
      const input = p.tool_input ?? {}
      if (p.tool_name === "SubagentHandback") return // internal report hand-off, not work
      if (isTask) {
        return emit({
          type: "dispatch",
          ...base,
          target: task.target,
          text: truncate(String(input.description ?? input.prompt ?? "task")),
          correlationId,
          requestedAgent: task.requestedAgent,
          prompt: clipMasked(input.prompt, MAX_LONG),
        })
      }
      if (!(await claimWrites(p.tool_name, input, { owner: sessionID, sessionID, agent }))) return
      return emit({ type: "activity", ...base, text: describe(p.tool_name, input) })
    }
    case "PostToolUse": {
      // Registered for Task|Agent only: the subagent's report comes back to its caller.
      if (!isTask) return
      const r = p.tool_response
      const handback = { type: "handback", agent: task.target, target: agent, sessionID, source, correlationId, requestedAgent: task.requestedAgent }
      // Background Task: PostToolUse fires at LAUNCH, so there is no evidence of the outcome yet (status unknown, no result).
      if (p.tool_input?.run_in_background === true) {
        return emit({ ...handback, text: truncate(responseText(r) || `launched in background: ${p.tool_input?.description ?? "task"}`, 200), status: "unknown" })
      }
      return emit({
        ...handback,
        text: truncate(String(p.tool_input?.description ?? "task")),
        status: "ok",
        result: clipMasked(responseText(r), MAX_LONG),
        durationMs: typeof r?.totalDurationMs === "number" ? r.totalDurationMs : undefined,
      })
    }
    case "PostToolUseFailure":
      await emit({ type: "error", ...base, text: truncate(`${p.tool_name} gagal`), toolName: p.tool_name, correlationId })
      if (!isTask) return
      return emit({
        type: "handback",
        agent: task.target,
        target: agent,
        sessionID,
        source,
        text: truncate(String(p.tool_input?.description ?? "task")),
        correlationId,
        requestedAgent: task.requestedAgent,
        status: "error",
        error: clipMasked(typeof p.error === "string" ? p.error : String(p.error?.message ?? "error"), 1000),
      })
    case "SubagentStop":
      // Without agent_type this is labelled orchestrator; the reason keeps it from settling the orchestrator's other dispatches.
      return emit({ type: "idle", ...base, ...(sub ? {} : { reason: "subagent-stop" }) })
    case "Stop":
    case "SessionEnd":
      await release({ owner: sessionID }) // owner is the session: subagent stops must not release
      return emit({ type: "idle", agent: "orchestrator", sessionID, source })
  }
}

try {
  if (source === "cline") await cline()
  else if (source === "claude") await claude()
} catch {}

logLine({ kind: "hook", hookName: logCtx.hookName, tool: logCtx.tool, durMs: Date.now() - startedAt, decision: result && result.hookSpecificOutput ? "denied" : undefined })
if (result) process.stdout.write(JSON.stringify(result) + "\n")
process.exit(0)
