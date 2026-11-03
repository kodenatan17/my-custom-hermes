import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { audit, effectiveAllow, render, usageByAgent } from "../tools-audit.mjs"

const rule = (action, effect) => ({ action, resource: "*", effect })
const whitelist = (...allow) => [rule("*", "allow"), rule("*", "deny"), ...allow.map((a) => rule(a, "allow"))]

function ledger(records) {
  const state = mkdtempSync(join(tmpdir(), "audit-"))
  records.forEach((r, i) => {
    const dir = join(state, "executions", `ex_${i}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "record.json"), JSON.stringify({ agent_id: r.agent, tool_calls: { count: 1, by_tool: r.tools } }))
  })
  return state
}

test("effectiveAllow reads only the rules after the last deny-all", () => {
  assert.deepEqual(effectiveAllow(whitelist("read", "grep")), { whitelisted: true, allow: ["read", "grep"] })
  const open = effectiveAllow([rule("*", "allow"), rule("shell", "deny")])
  assert.equal(open.whitelisted, false)
})

test("usageByAgent maps ledger names to actions and keeps unknown tools separate", () => {
  const u = usageByAgent(ledger([{ agent: "coder", tools: { read: 3, write: 2, edit: 1, shell: 4, execute: 5, shell_client: 9 } }]))
  assert.equal(u.coder.runs, 1)
  assert.equal(u.coder.actions.edit, 3)
  assert.deepEqual(u.coder.offList, { execute: 5, shell_client: 9 })
})

test("audit flags loaded-but-unused, tool hunting, a missing whitelist and respects KEEP and min runs", () => {
  const records = Array.from({ length: 5 }, () => ({ agent: "scout", tools: { read: 4, grep: 2, execute: 1 } }))
  const usage = usageByAgent(ledger(records))
  const rows = audit(
    [
      { id: "scout", permissions: whitelist("read", "grep", "glob", "webfetch") },
      { id: "coder", permissions: [rule("*", "allow")] },
    ],
    usage,
  )
  const scout = rows.find((r) => r.id === "scout")
  assert.deepEqual(scout.unused, ["glob"])
  assert.deepEqual(scout.kept, ["webfetch"])
  assert.deepEqual(scout.missing, ["execute×5"])
  const coder = rows.find((r) => r.id === "coder")
  assert.equal(coder.whitelisted, false)
  assert.equal(coder.enough, false)
  const text = render(rows)
  assert.match(text, /loaded but never used: glob/)
  assert.match(text, /kept on purpose: webfetch/)
  assert.match(text, /tool hunting\): execute×5/)
  assert.match(text, /no `"\*": false` whitelist/)
})

test("an agent whose every loaded tool is used is clean", () => {
  const usage = usageByAgent(ledger(Array.from({ length: 5 }, () => ({ agent: "architect", tools: { read: 1, grep: 1, glob: 1, skill: 1 } }))))
  const [row] = audit([{ id: "architect", permissions: whitelist("read", "grep", "glob", "skill") }], usage)
  assert.deepEqual(row.unused, [])
  assert.match(render([row]), /every loaded tool is used/)
})
