import { test, before, after, describe } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs"
import { tmpdir } from "node:os"

// Cline 4.1.x (SDK hooks): scripts are named after legacy events but the payload hookName is the SDK name.
const HERE = dirname(fileURLToPath(import.meta.url))
const HOOK = join(HERE, "..", "hook.mjs")
const DAEMON = join(HERE, "..", "daemon.mjs")
const ROOT = join(HERE, "..", "..", "..")
const SCRIPTS = join(ROOT, ".clinerules", "hooks")
const PORT = 4797
const TMP = mkdtempSync(join(tmpdir(), "clinesdk-"))
const LOG = join(TMP, "hook.log")
const SHELL_LOG = join(TMP, "hook-shell.log")
const COORD = join(TMP, "coordination.json")
let child

const f = (feature) => `seedly_app/lib/features/${feature}/z.dart`
const abs = (feature) => join(ROOT, f(feature))
const post = (path, body) => fetch(`http://127.0.0.1:${PORT}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json())
const locks = async () => (await (await fetch(`http://127.0.0.1:${PORT}/locks`)).json()).locks.map((l) => l.feature)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const HOOK_ENV = { OFFICE_BRIDGE_PORT: String(PORT), OFFICE_NODE: process.execPath, OFFICE_HOOK_LOG: LOG, OFFICE_HOOK_SHELL_LOG: SHELL_LOG, OFFICE_MAX_WAIT_SECONDS: "1" }

function run(cmd, args, payload, env, replaceEnv = false) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env: replaceEnv ? env : { ...process.env, ...HOOK_ENV, ...env }, stdio: ["pipe", "pipe", "pipe"] })
    let out = ""
    p.stdout.on("data", (c) => (out += c))
    p.on("close", (code) => resolve({ code, out, json: (() => { try { return JSON.parse(out) } catch { return null } })() }))
    p.stdin.end(typeof payload === "string" ? payload : JSON.stringify(payload))
  })
}
const hook = (payload, event, env) => run(process.execPath, [HOOK, "cline", ...(event ? [event] : [])], payload, env)
const sdk = (hookName, taskId, extra = {}) => ({ taskId, hookName, agent_id: "a1", ...extra })
const toolCall = (name, input, taskId) => sdk("tool_call", taskId, { tool_call: { id: "c1", name, input }, preToolUse: { toolName: name, parameters: input } })

before(async () => {
  writeFileSync(COORD, JSON.stringify({ supersedeIdleSeconds: 0.3, maxWaitSeconds: { cline: 1 } }))
  child = spawn(process.execPath, [DAEMON], { env: { ...process.env, OFFICE_BRIDGE_PORT: String(PORT), OFFICE_COORDINATION: COORD }, stdio: "ignore" })
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break } catch {} await sleep(100) }
})
after(() => { child?.kill("SIGKILL") })

const claim = (owner, source, feature) => post("/claim", { owner, source, sessionID: owner, path: f(feature) })

describe("Cline SDK-shaped payloads", () => {
  test("tool_call write_to_file on a feature held by another owner => cancel:false + context warning naming feature + holder", async () => {
    await claim("oc:h", "opencode", "auth")
    const r = await hook(toolCall("write_to_file", { path: abs("auth") }, "T-deny"))
    assert.equal(r.json.cancel, false)
    assert.match(r.json.context, /auth/)
    assert.match(r.json.context, /opencode/)
  })
  test("tool_call read_files is never gated", async () => {
    const r = await hook(toolCall("read_files", { files: [abs("auth")] }, "T-read"))
    assert.deepEqual(r.json, { cancel: false })
  })
  test("tool_call write on a free feature is granted", async () => {
    const r = await hook(toolCall("write_to_file", { path: abs("freeA") }, "T-free"))
    assert.deepEqual(r.json, { cancel: false })
    assert.ok((await locks()).includes("freeA"))
  })
  for (const name of ["agent_end", "agent_abort", "agent_error", "session_shutdown"]) {
    test(`${name} releases the owner's locks`, async () => {
      const feat = `rel_${name}`
      const task = `T-${name}`
      await claim(`cline:${task}`, "cline", feat)
      assert.ok((await locks()).includes(feat))
      const r = await hook(sdk(name, task, name === "agent_error" ? { error: { name: "E", message: "boom" } } : {}))
      assert.equal(r.code, 0)
      assert.ok(!(await locks()).includes(feat))
    })
  }
  test("agent_error accepts a plain string error", async () => {
    const r = await hook(sdk("agent_error", "T-str", { error: "plain" }))
    assert.equal(r.code, 0)
  })
  test("agent_start supersedes a stale same-source owner's lock", async () => {
    await claim("cline:OLD", "cline", "stale1")
    await sleep(700) // > supersedeIdleSeconds (0.3s)
    await hook(sdk("agent_start", "NEW"))
    assert.ok(!(await locks()).includes("stale1"))
  })
  test("legacy hookName values still work (TaskComplete releases, PreToolUse gated)", async () => {
    await claim("cline:LEG", "cline", "legacy1")
    await hook({ hookName: "TaskComplete", taskId: "LEG" })
    assert.ok(!(await locks()).includes("legacy1"))
    await claim("oc:h2", "opencode", "home")
    const r = await hook({ hookName: "PreToolUse", taskId: "LEG2", preToolUse: { toolName: "edit", parameters: { path: abs("home") } } })
    assert.equal(r.json.cancel, false)
    assert.match(r.json.context, /home/)
  })
  test("argv event overrides hookName", async () => {
    await claim("cline:ARG", "cline", "argv1")
    await hook(sdk("tool_call", "ARG"), "TaskComplete") // hookName says tool_call, script says TaskComplete
    assert.ok(!(await locks()).includes("argv1"))
  })
  test("tool_result failure shapes are all tolerated and logged without crashing", async () => {
    for (const extra of [{ postToolUse: { toolName: "x", success: false } }, { tool_result: { name: "x", error: "bad" } }, { tool_result: { name: "x", isError: true } }, { postToolUse: { toolName: "x", success: true } }]) {
      const r = await hook(sdk("tool_result", "T-res", extra))
      assert.equal(r.code, 0)
    }
    assert.ok(readFileSync(LOG, "utf8").includes('"hookName":"PostToolUse"'))
  })
})

describe("shell breadcrumb", () => {
  test("PreToolUse with a minimal env writes a breadcrumb and still emits cancel:false", async () => {
    const env = { HOME: process.env.HOME, PATH: "/usr/bin:/bin", ...HOOK_ENV }
    const payload = toolCall("read_files", { files: [abs("auth")] }, "T-sh")
    const r = await run("env", ["-i", ...Object.entries(env).map(([k, v]) => `${k}=${v}`), "bash", join(SCRIPTS, "PreToolUse")], payload, env, true)
    assert.deepEqual(r.json, { cancel: false })
    const line = readFileSync(SHELL_LOG, "utf8").trim().split("\n").pop()
    assert.match(line, /^\d{4}-\d\d-\d\dT[\d:]+Z cline PreToolUse node=\S+ ppid=\d+$/)
  })
  test("all 8 scripts are executable and pass their own event name", () => {
    for (const n of ["PreToolUse", "PostToolUse", "TaskStart", "TaskResume", "TaskCancel", "TaskComplete", "TaskError", "UserPromptSubmit"]) {
      const p = join(SCRIPTS, `${n}`)
      assert.ok(statSync(p).mode & 0o100, `${n} executable`)
      assert.ok(readFileSync(p, "utf8").includes(`cline ${n}`))
    }
  })
  test("hook.sh finds node with env -i and a minimal PATH (VS Code case) and still logs", async (t) => {
    const shellLog = join(TMP, "minpath-shell.log")
    const hookLog = join(TMP, "minpath-hook.log")
    const homes = [join(process.env.HOME ?? "/root", ".hermes", "node", "bin"), "/opt/homebrew/bin", "/usr/local/bin"]
    if (!homes.some((d) => existsSync(join(d, "node")))) return t.skip("no node outside PATH on this machine")
    const env = { HOME: process.env.HOME ?? "/root", PATH: "/usr/bin:/bin", OFFICE_BRIDGE_PORT: String(PORT), OFFICE_HOOK_SHELL_LOG: shellLog, OFFICE_HOOK_LOG: hookLog }
    const r = await run("env", ["-i", ...Object.entries(env).map(([k, v]) => `${k}=${v}`), "bash", join(HERE, "..", "hook.sh"), "claude"], { hook_event_name: "SessionStart", session_id: "s-min" }, env, true)
    assert.equal(r.code, 0)
    assert.match(readFileSync(shellLog, "utf8").trim().split("\n").pop(), / claude - node=\/.* ppid=\d+$/)
    assert.match(readFileSync(hookLog, "utf8"), /"source":"claude"/)
  })
  test("breadcrumb rotates to .1 when the log passes 200KB", async () => {
    const big = join(TMP, "big.log")
    writeFileSync(big, "x".repeat(210 * 1024))
    const env = { ...HOOK_ENV, OFFICE_HOOK_SHELL_LOG: big }
    await run("bash", [join(SCRIPTS, "TaskComplete")], { hookName: "agent_end", taskId: "T-big" }, env)
    assert.equal(statSync(`${big}.1`).size, 210 * 1024)
    assert.match(readFileSync(big, "utf8"), / TaskComplete node=\S+ ppid=\d+\n$/)
  })
})

describe("Agent Interaction Viewer: Cline fields", () => {
  async function capture(run) {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
    const events = []
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.type !== "hello") events.push(d) }
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
    try { await run(); await sleep(200) } finally { ws.close() }
    return events.filter((e) => e.sessionID === "cline:T-aiv")
  }
  test("prompt_submit carries a masked full prompt; tool_result failure carries toolName", async () => {
    const got = await capture(async () => {
      await hook(sdk("prompt_submit", "T-aiv", { userPromptSubmit: { prompt: "ship it\nwith api_key=abc123" } }))
      await hook(sdk("tool_result", "T-aiv", { postToolUse: { toolName: "execute_command", success: false } }))
    })
    const p = got.find((e) => e.type === "prompt"), err = got.find((e) => e.type === "error")
    assert.equal(p.prompt, "ship it\nwith api_key=***")
    assert.equal(err.toolName, "execute_command")
  })
})
