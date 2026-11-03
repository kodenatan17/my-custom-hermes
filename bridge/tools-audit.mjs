// Are the tools an agent loads the tools it uses? Compares what OpenCode loads for each agent (the permission rules
// of `opencode debug agents`, after the `"*": false` whitelist in the agent's frontmatter) with what the agent really
// called in finished Hermes runs (execution ledger).
//
//   oc-tools [--min-runs N] [--strict]
//
// Loaded but never used  -> remove it from the agent's `tools:` block (each loaded tool costs tokens on every request).
// Used but not loaded    -> the agent went looking for a tool it does not have (`execute`, `shell_client`, ...): wasted calls.
// --strict exits 1 when a loaded tool has zero uses in at least N runs (default 5), except the KEEP list below.
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Ledger tool name -> OpenCode permission action.
export const LEDGER_ACTION = { read: "read", grep: "grep", glob: "glob", list: "list", lsp: "lsp", edit: "edit", write: "edit", patch: "edit", shell: "shell", skill: "skill", webfetch: "webfetch", websearch: "webfetch" }
// Loaded on purpose although rarely used: the role's reason to exist.
export const KEEP = { scout: { webfetch: "external-docs mode" } }

export const stateDir = (env = process.env) => env.AGENT_OS_STATE_DIR || join(env.HOME || homedir(), ".local", "state", "hermes-agent-os")

// Actions still allowed after the last `deny *` rule (the whitelist); with no deny-all, everything not denied.
export function effectiveAllow(rules) {
  const last = rules.map((r) => `${r.action}:${r.effect}`).lastIndexOf("*:deny")
  if (last < 0) return { whitelisted: false, allow: [...new Set(rules.filter((r) => r.effect === "allow").map((r) => r.action))] }
  return { whitelisted: true, allow: [...new Set(rules.slice(last + 1).filter((r) => r.effect === "allow").map((r) => r.action))] }
}

export function usageByAgent(state) {
  const dir = join(state, "executions")
  const by = {}
  if (!existsSync(dir)) return by
  for (const id of readdirSync(dir)) {
    let r
    try {
      r = JSON.parse(readFileSync(join(dir, id, "record.json"), "utf8"))
    } catch {
      continue
    }
    if (!r.tool_calls?.by_tool || !r.agent_id) continue
    const o = (by[r.agent_id] ??= { runs: 0, calls: 0, actions: {}, offList: {} })
    o.runs++
    for (const [tool, n] of Object.entries(r.tool_calls.by_tool)) {
      o.calls += n
      const action = LEDGER_ACTION[tool]
      if (action) o.actions[action] = (o.actions[action] ?? 0) + n
      else o.offList[tool] = (o.offList[tool] ?? 0) + n
    }
  }
  return by
}

export function audit(agents, usage, minRuns = 5) {
  return agents.map(({ id, permissions }) => {
    const { whitelisted, allow } = effectiveAllow(permissions ?? [])
    const u = usage[id] ?? { runs: 0, calls: 0, actions: {}, offList: {} }
    const tools = allow.filter((a) => a !== "*")
    const enough = u.runs >= minRuns
    const unused = enough ? tools.filter((a) => !u.actions[a] && !KEEP[id]?.[a]) : []
    const kept = enough ? tools.filter((a) => !u.actions[a] && KEEP[id]?.[a]) : []
    const missing = Object.entries(u.offList).filter(([, n]) => n > 0).map(([t, n]) => `${t}×${n}`)
    return { id, whitelisted, tools, runs: u.runs, calls: u.calls, unused, kept, missing, enough }
  })
}

export function render(rows, minRuns = 5) {
  const out = []
  for (const r of rows) {
    const flags = []
    if (!r.whitelisted) flags.push("⚠ no `\"*\": false` whitelist: every tool OpenCode has stays loaded")
    if (r.unused.length) flags.push(`⚠ loaded but never used: ${r.unused.join(", ")}`)
    if (r.kept.length) flags.push(`kept on purpose: ${r.kept.join(", ")}`)
    if (r.missing.length) flags.push(`⚠ used but not loaded (tool hunting): ${r.missing.join(", ")}`)
    if (!r.enough) flags.push(`only ${r.runs} run(s) in history (need ${minRuns}), unused check skipped`)
    out.push(`${r.id.padEnd(11)} loads ${r.tools.join(",") || "-"}  ·  ${r.runs} runs, ${r.calls} calls${flags.length ? "\n" + flags.map((f) => `  ${f}`).join("\n") : "\n  ✓ every loaded tool is used"}`)
  }
  return out.join("\n")
}

function listAgents(root) {
  const bin = join(homedir(), ".local", "bin", "opencode")
  const r = spawnSync(existsSync(bin) ? bin : "opencode", ["debug", "agents"], { cwd: root, env: { ...process.env, PWD: root }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  try {
    return JSON.parse(r.stdout)
  } catch {
    return null
  }
}

export function main(argv, env = process.env) {
  const i = argv.indexOf("--min-runs")
  const minRuns = i >= 0 ? Number(argv[i + 1]) || 5 : 5
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
  const agents = listAgents(root)
  if (!agents) return console.error("could not list OpenCode agents (opencode debug agents)"), 2
  const rows = audit(agents.filter((a) => a.mode !== "none" && a.permissions), usageByAgent(stateDir(env)), minRuns)
    .filter((r) => ["scout", "architect", "coder", "qa", "reviewer", "documenter", "devops", "hermes", "observer"].includes(r.id))
  console.log(render(rows, minRuns))
  const bad = rows.some((r) => !r.whitelisted || r.unused.length)
  return argv.includes("--strict") && bad ? 1 : 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)))
