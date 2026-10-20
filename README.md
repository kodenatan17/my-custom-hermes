# opencode Multi-Agent Workspace

This directory contains the project-local opencode setup for the **Seedly Flutter app** (`seedly_app/`). Seedly's broader system also includes a Go backend, ESP32 firmware, and a Next.js admin CMS, but this workspace only builds the Flutter client — it reads the other systems' specs for context (what APIs the app consumes) and never implements them. It defines 9 agents (1 orchestrator + 8 subagents), 5 domain skills, 17 slash commands, 9Router model routing, and an event/lock bridge with a visualizer (Workflow View + Agent Chat View). The same roster is exposed to Claude Code and Cline (see [Multi-tool setup](#multi-tool-setup-opencode--cline--claude-code)).

## Directory Layout

```text
.opencode/
├── opencode.json              # default agent, disabled built-ins, global tool switches
├── coordination.json          # write-lock config (pathRules, wait budgets, onConflict, liveness)
├── tsconfig.json              # typechecks plugins/**/*.ts and bridge/**/*.d.mts only
├── agents/                    # one .md per agent (file name = agent name; keep it flat)
├── commands/                  # one .md per slash command, each carrying only its own route
├── skills/                    # domain skills, loaded on demand
├── bin/oc                     # runs the real roster from any shell (used by Cline)
├── bridge/                    # tool-agnostic event/lock bridge (zero-dependency Node ESM)
│   ├── daemon.mjs             # owns ws://localhost:4777 + HTTP endpoints
│   ├── emit.mjs (+ .d.mts)    # client: POST an event (auto-starts the daemon), claim/release/supersede
│   ├── hook.mjs               # Cline / Claude Code hook payloads -> events + lock enforcement
│   ├── mask.mjs (+ .d.mts)    # secret masking shared by producers, daemon and UI
│   ├── coordinator.mjs        # per-feature write locks (liveness, queue, breaker)
│   ├── sync.mjs               # generates the Claude Code / Cline copies of agents, commands, skills
│   ├── demo-locks.mjs         # lock contention demo
│   ├── test/                  # node:test suites for the bridge
│   └── hook.log               # JSONL decision log (git-ignored)
├── plugins/
│   ├── memory-recall.ts       # injects relevant Hermes memory into prompts (no tool calls)
│   ├── lib/memory-score.ts    # keyword scorer used by memory-recall
│   └── office-bridge.ts       # OpenCode -> bridge (events + write locks)
├── visualizer/                # Vite + React app: Workflow View (3D office) and Agent Chat View
│   ├── src/chat/              # Agent Chat View (model.mjs store + ChatView/AgentList/Timeline/DetailPanel)
│   └── test/                  # node:test suites for the chat store and the workflow reducer
├── archive/agents-v1/         # previous 19-agent setup, kept for reference (not loaded)
├── package.json
└── package-lock.json
```

Outside this directory, the same setup is wired into the other tools: `../AGENTS.md` and `../CLAUDE.md` (instructions), `../.claude/` (generated agents/commands/orchestrator, plus a hand-written `settings.json`), `../.clinerules/` (Cline hooks and generated workflows, plus `no-polling-loops.md`).

> Agent files must sit directly in `agents/`. opencode names nested files by path (`subagents/research/scout`), which breaks `agent:` references in commands.

## Agent Model

One orchestrator plus seven focused subagents and the memory manager. Every definition (model, tools, prompt) lives in its `.md` frontmatter only, so there is a single source of truth.

| Agent | Name | Role | Model |
| --- | --- | --- | --- |
| `orchestrator` (primary, default) | Risko | Routes commands, keeps handoffs ≤ 30 lines, runs the review loop | `ninerouter/solo-orchestrator` |
| `scout` | Pingot | Read-only: find files/patterns, analyze flow and impact, diagnose root causes, external docs | `ninerouter/researcher-deep` |
| `architect` | Bima | Read-only: design, implementation steps, spec/business-rule validation | `ninerouter/planning-architect` |
| `coder` | Zaki | Implement / fix / refactor / performance changes in `seedly_app/` | `ninerouter/implementation-high` |
| `qa` | Lulu | Write and run tests only | `ninerouter/quality-safer` |
| `reviewer` | Sari | Read-only review incl. security checks | `ninerouter/quality-high` |
| `documenter` | Nadia | Docs, solutioning docs (targeted README/CHANGELOG updates), code comments | `ninerouter/documentation-low` |
| `devops` | Dimas | CI/build/signing/release tooling | `ninerouter/infrastructure-high` |
| `memory-manager` | Arsa | Only agent with Hermes MCP tools; writeback + memory commands | `ninerouter/quality-safer` |

Each agent file opens with a short **Soul**: a name, a character, and the habits that keep it from making mistakes (evidence for every claim, small diffs, real test output, a self-check before reporting). Each file's heading is `# <Nama> - <Peran>` (e.g. `# Pingot - Analyst`); the visualizer reads name and role from that heading, so renaming an agent only means editing its file.

opencode's built-in `general` and `explore` subagents are disabled in `opencode.json` so the orchestrator only delegates to this roster.

## Tool Permission Pattern

- `scout`, `architect`, `reviewer`: read-only (`scout` also has `webfetch`).
- `coder`, `qa`, `devops`: write + bash. `documenter`: write, no bash.
- `hermes-memory_*` tools are off globally (`opencode.json`) and enabled only for `memory-manager`, so their schemas aren't sent with every other agent's requests.

## Skills

Project skills live under:

```text
.opencode/skills/<skill-name>/SKILL.md
```

This workspace builds only the Seedly **Flutter app** (`seedly_app/`) — it
never implements the Go backend, ESP32 firmware, or Next.js admin CMS.
Specs for those systems are still read for context (the app consumes their
APIs), but no skill here covers building them.

Current skills:

| Skill | Focus |
| --- | --- |
| `spec-first` | Resolve any feature task to concrete spec file(s) under `garden-ai/solutioning/specs/`, read them, treat as truth — never invent requirements. |
| `flutter-client-architecture` | Bloc + go_router conventions, app-is-projection-surface rule, `lib/features/{domain}` folder convention. |
| `api-contract-conventions` | How the app calls the documented backend API correctly: versioning, error envelope, cursor pagination, `Idempotency-Key`, async submit-then-poll flows. |
| `security-boundaries` | App-side auth only: token handling, never trusting local state for server-authoritative values, upload pre-checks are UX-only. |
| `seed-visualization` | How each seed species is drawn as an animated procedural potted plant (`garden/.../plant_visual/`), and the checklist to add or change a species: resolver, blueprint builder, l10n, mock, tests. |

Skills are loaded on demand when the task matches their domain. `spec-first` holds the keyword → spec file map, so specs are opened selectively instead of reading the ~690 KB spec tree.

## Command Workflows

Each command is a file in `commands/`, so only the invoked command's route is sent to the model.

| Command | Route |
| --- | --- |
| `/feature` | small: `scout → coder → reviewer` · medium: `+ qa` · architecture: `scout → architect → coder → reviewer → qa` |
| `/bugfix` | `scout (diagnose) → coder (fix) → reviewer` (+ `qa` if business logic changed) |
| `/refactor` | `scout → coder → reviewer` (+ `qa` if large) |
| `/review` | `reviewer` |
| `/security` | `reviewer` (security mode); `coder → reviewer` only if fixes are requested |
| `/performance` | `scout → coder → reviewer` |
| `/document`, `/comment` | `documenter` (runs directly, no orchestrator) |
| `/devops` | `devops → reviewer` |
| `/analyze` | `scout` (+ `architect` for design questions); answered from memory when possible |
| `/solutioning` | doc-only: `documenter` · spec/design: `architect → documenter` (only if files change) |
| `/memory`, `/memory-status`, `/memory-search`, `/compact`, `/forget` | `memory-manager` directly (subtask) |
| `/help` | static list |

### Workflow Rules

- Handoffs between agents are summaries (≤ 30 lines), never full outputs.
- Reviewer `FAIL` → coder gets only `REQUIRED_FIXES`; max 2 rounds, then the orchestrator pauses for you.
- Tool-call budgets: small 15 · medium 40 · architecture 80.
- `memory-manager` runs only when a workflow produced something reusable (decision, root cause, gotcha, pattern).

### Memory

`plugins/memory-recall.ts` reads the Hermes knowledge graph (`~/.hermes/profiles/rtdigital/memories/mcp/knowledge.json`) directly, scores entities against each prompt by keyword, and appends the top matches (≤ ~1k tokens) to that session's system prompt as `MEMORY CONTEXT`. That covers the orchestrator and every subagent (based on its own task), with no MCP round trips. The orchestrator answers `/analyze` and `/solutioning` questions from memory when it already has the answer.

- `MEMORY_RECALL=off` disables it; `MEMORY_RECALL_FILE=/path/knowledge.json` points it elsewhere.
- Writes still go through `memory-manager` (hermes-memory MCP). Its `search_nodes` matches the query as one substring, so the manager searches one keyword per call.

## 9Router Setup

This configuration routes opencode agents through 9Router model IDs such as:

```text
ninerouter/researcher-fast
ninerouter/researcher-deep
ninerouter/implementation-low
ninerouter/implementation-high
ninerouter/quality-high
ninerouter/quality-safer
ninerouter/infrastructure-low
ninerouter/infrastructure-high
ninerouter/documentation-low
ninerouter/solo-orchestrator
```

### 1. Install opencode

Follow official opencode installation instructions for your environment.

```sh
npm install -g opencode-ai
```

If your installation uses a different package or binary name, keep that official method.

### 2. Configure 9Router Credentials

Set your 9Router API key in your shell environment. Use your actual key value.

```sh
export NINEROUTER_API_KEY="your-api-key"
```

If your 9Router provider uses OpenAI-compatible environment variables, also set:

```sh
export OPENAI_API_KEY="$NINEROUTER_API_KEY"
export OPENAI_BASE_URL="https://api.9router.ai/v1"
```

Use the exact base URL from your 9Router account/provider documentation if it differs.

### 3. Configure opencode Provider

Agent models are set in each agent's frontmatter (`model: ninerouter/<model>`); the `ninerouter` provider itself is defined in the global `~/.config/opencode/opencode.jsonc`.

If opencode requires an explicit custom provider in your environment, add provider settings according to the current opencode schema at:

```text
https://opencode.ai/config.json
```

Do not commit API keys into `.opencode/opencode.json`.

### 4. Install Local Dependencies

From `.opencode/`:

```sh
npm install
```

Type-check local plugin/dev files if needed:

```sh
npm run typecheck
```

### 5. Start opencode From Repository Root

From repository root:

```sh
opencode
```

opencode walks up from the current directory and loads project config from `.opencode/opencode.json`.

### 6. Restart After Config Changes

opencode loads config once at startup. After changing `.opencode/opencode.json`, agent files, skill files, plugins, MCP servers, or permissions, quit and restart opencode.

## Adding an Agent

Create `.opencode/agents/<agent-name>.md` (flat — no subfolders):

```markdown
---
description: Short trigger-focused description.
mode: subagent
model: ninerouter/implementation-low
tools:
  read: true
  write: false
  bash: false
---

Short prompt: role, rules, output format.
```

- Keep prompts short (the current ones are 1–2 KB); every line is paid on every model step.
- Add it to the orchestrator's roster line and to any command route that should use it.
- For the visualizer, add its category to `CATEGORY_BY_AGENT` in `visualizer/src/agents.ts`.

## Adding a Skill

Create:

```text
.opencode/skills/<skill-name>/SKILL.md
```

Recommended format:

```markdown
---
name: my-skill
description: Use when working on specific domain, files, or keywords.
---

# My Skill

Instructions, rules, examples, and constraints.
```

Rules:

- Folder name and `name` should match.
- Use lowercase hyphen-separated names.
- Description should say when to use the skill.
- Keep skill scope narrow to avoid noisy routing.

## Office Visualizer

`visualizer/` is one Vite + React app with two views of the same live event stream (toggle at the bottom of the page):

- **Workflow View** (default): a 3D "team room" showing agents at work while you prompt. Each agent has a seat at its team room's round table, and the orchestrator walks over to whoever it just delegated to. Bubbles show the running tool, and the whiteboard and cards show task status.
- **Agent Chat View** (`?view=chat`): a read-only, Slack-style monitor of who sent what to whom. See [Agent Chat View](#agent-chat-view).

Events reach the page from the bridge daemon on `ws://localhost:4777` (`plugins/office-bridge.ts` for OpenCode, `bridge/hook.mjs` for Claude Code and Cline; see [Multi-tool setup](#multi-tool-setup-opencode--cline--claude-code)).

```bash
cd .opencode/visualizer
npm install
npm run dev        # open http://localhost:5173 (add ?demo for the scripted demo, ?view=chat for the Agent Chat View)
```

Then run `opencode`, Claude Code or Cline in this project as usual. Options:

| Env / param | Effect |
| --- | --- |
| `OFFICE_BRIDGE=off` | Disable the bridge for the tool that reads it (plugin, `emit`, hooks, lock client) |
| `OFFICE_BRIDGE_PORT=4778` | Change the daemon port (then open the page with `?bridge=ws://localhost:4778`) |
| `?view=chat` | Open the Agent Chat View (the toggle keeps the URL in sync) |
| `?demo` | Scripted demo in the Workflow View only; never fed to the chat store |
| `# <Nama> - <Peran>` heading in `agents/<id>.md` | Display name and role shown in the office |

The office is a night scene with four team rooms, each with a round table the members sit around, a pendant lamp, a rug and themed props:

| Room | Members |
| --- | --- |
| Manager | orchestrator (Risko) — sits here, walks to a teammate's chair when delegating |
| Solution | qa, coder, reviewer, devops |
| Innovation | scout, architect |
| Archieve | documenter, memory-manager |

Room membership lives in `ROOM_OF` in `visualizer/src/rooms.ts`; agents without an entry join Solution. Each agent's gender for the character model comes from the `<!-- gender: female|male -->` line under its heading.

Idle agents don't just sit: up to ~40% of the team at a time wanders off to the coffee bar (stools, standing table, barista) or play PS5 on the sofa, and walk back to their room when they get a task. Tune how often in `visualizer/src/useIdleActivities.ts`, and add hang-out spots in `visualizer/src/spots.ts`.

At prayer time the free agents walk to the musholla and pray together: imam at the front (the orchestrator when it's free), makmum filling the saf from the middle out, with the correct number of rakaat. They wait for iqamah first, and Friday has a short khutbah before Jumat. Agents busy with a task join once they finish. Afterwards everyone goes back to what they were doing. Times are calculated locally with Kemenag parameters (Subuh 20°, Isya 18°, Ashar Syafi'i, +2 min ihtiyat); the default location is Jakarta.

| Param | Effect |
| --- | --- |
| `?lat=-7.25&lng=112.75&city=Surabaya` | Prayer times for another location |
| `?sholat=ashar` | Start a test prayer immediately (or press **Tes sholat** in the HUD) |
| `?sholat=ashar&sholatT=70` | Start the test 70 s in, to jump to a specific position |

Every `mode: subagent` file in `agents/` gets a seat automatically; its color comes from `CATEGORY_BY_AGENT` in `visualizer/src/agents.ts`. The standalone daemon owns the port; a second daemon exits silently (`EADDRINUSE`).

## Multi-tool setup (OpenCode + Cline + Claude Code)

`.opencode/` stays the single source of truth; see `../AGENTS.md` for the short version.

### How each tool triggers the roster

| Tool | Trigger | Visualizer feed |
| --- | --- | --- |
| OpenCode | Native: `agents/`, `commands/` and `skills/` are read directly (`/feature`, `/bugfix`, ...). | `plugins/office-bridge.ts` |
| Claude Code | `../CLAUDE.md` imports `../.claude/orchestrator.md`; the model delegates with the Task tool to `../.claude/agents/*` and uses `../.claude/commands/*`. | `bridge/hook.mjs claude` via `../.claude/settings.json` |
| Cline | Cannot load named agents. Workflows in `../.clinerules/workflows/` run the real OpenCode roster through `bin/oc`. | `bridge/hook.mjs cline` via `../.clinerules/hooks/*.sh` |

`bin/oc` runs the real roster from any shell: `oc cmd feature "<request>"` or `oc agent scout "<question>"` (the latter is routed via the orchestrator, since subagents cannot be `opencode run --agent` targets). Names must match `^[a-z][a-z0-9-]*$`.

### `bridge/sync.mjs`

`node .opencode/bridge/sync.mjs` regenerates, from `agents/`, `commands/` and `skills/` (re-run after editing them):

- `../.claude/agents/*.md`: every `mode: subagent` agent except `memory-manager` (needs Hermes MCP tools, OpenCode only); tools mapped to Claude tool names.
- `../.claude/commands/*.md` and `../.clinerules/workflows/*.md`: every command except `memory`, `memory-status`, `memory-search`, `compact`, `forget`, `help`.
- `../.claude/orchestrator.md`: the orchestrator prompt with the Memory sections and the `memory-manager` roster line removed.
- `../.claude/skills`: a symlink to `.opencode/skills` (Claude Code and Cline both read it).

Generated files start with a `GENERATED by .opencode/bridge/sync.mjs` marker; stale generated files are removed, hand-written ones never are. **`../.claude/settings.json` (the Claude Code hooks) is NOT generated** by sync; edit it by hand. Likewise `../.clinerules/hooks/*.sh` and `no-polling-loops.md` are hand-written.

### Bridge components

- **`bridge/daemon.mjs`**: one standalone process (no dependencies, binds `127.0.0.1`) that owns `ws://localhost:4777` (port: `OFFICE_BRIDGE_PORT`). Clients auto-start it; if the port is already taken the new process exits silently. HTTP endpoints:

  | Endpoint | Purpose |
  | --- | --- |
  | `POST /event` | One event or an array. Sanitized, stamped with `ts` + `eventId`, broadcast and stored for replay. Also marks the owner live. |
  | `POST /claim` | Write-lock a feature: `200` granted or `409` denied (holder, queuePosition). Needs `owner`, `source`, `path`. |
  | `POST /release` | `{owner, feature?}` releases locks. |
  | `POST /supersede` | `{source, owner}` drops idle same-source owners' locks. |
  | `GET /locks` | Current locks and waiters. |
  | `GET /health` | `{ok, clients, replay, replayBytes, locks}`. |

  Guards: `Host` must be `localhost:<port>` or `127.0.0.1:<port>`; a present `Origin` must be `http://localhost:5173`, `http://127.0.0.1:5173` or `OFFICE_VISUALIZER_ORIGIN` (otherwise 403); POST needs `application/json` (415), body at most 64 KB (413), bad JSON is 400. There is no authentication beyond that, so any local process can post events. WebSocket clients get `{type:"hello", replay}` and then live events; client frames other than ping/close are ignored.
- **`bridge/emit.mjs`**: client used by the plugin and hooks. `emit()` never throws; on `ECONNREFUSED` it spawns the daemon (guarded by a spawn file in the temp dir, 30 s negative cache) and retries. It also exposes `claim`/`release`/`supersede`, which fail open when the daemon is unreachable. `OFFICE_BRIDGE=off` makes all of them no-ops.
- **`bridge/hook.mjs <cline|claude>`**: reads the hook payload on stdin, always exits 0, emits events (see the per-tool matrix below) and enforces write locks. Claude Code hooks registered in `../.claude/settings.json`: `SessionStart`, `UserPromptSubmit`, `PreToolUse` (all tools), `PostToolUse` (only `Task|Agent`), `PostToolUseFailure` (all tools), `SubagentStop`, `Stop`, `SessionEnd`. Cline hooks in `../.clinerules/hooks/`: `TaskStart`, `TaskResume`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `TaskComplete`, `TaskCancel`, `TaskError` (each script calls `hook.mjs cline <Event>`, falling back to `{"cancel":false}`).
- **`plugins/office-bridge.ts`**: OpenCode plugin (v2 plugin API). Turns session/tool events into bridge events and claims write locks before `edit`/`write`/`patch`; denial is a thrown Error, daemon trouble fails open.
- **`bridge/coordinator.mjs`**: the write-lock logic used by the daemon (see [Feature write locks](#feature-write-locks)); configured by `coordination.json` (`OFFICE_COORDINATION` overrides the path).
- **`bridge/hook.log`**: see below. `OFFICE_HOOK_LOG` overrides its path. Cline scripts also append a breadcrumb to `bridge/hook-shell.log` (`OFFICE_HOOK_SHELL_LOG` overrides; capped at ~200 KB; git-ignored).
- Restart OpenCode after updating: an older instance still running the in-process bridge keeps port 4777. Restart the daemon too after upgrading `bridge/` (see [Limitations](#limitations-and-known-gaps)).

### Feature write locks

Write tools (edit/write/patch) claim a feature (`coordination.json`, `pathRules`; cross-cutting files use the sentinel feature `_shared`) through the daemon before running.

- **Solo mode**: locks only matter when ANOTHER tool/session is live. A single tool alone (e.g. only Cline) is never denied, never waits and produces no `lock.*` events.
- **Liveness**: the daemon records `lastSeen` per owner from every `/event` and `/claim` (denied claims too). An owner is live for `liveSeconds` (120) after its last sign of life. A holder that went silent (crashed or cancelled task) is taken over by the next claim (`lock.expired`, reason `stale`); `ttlSeconds` stays the hard upper bound. A waiter that is no longer live never keeps a free lock reserved. Locks that were never announced (solo mode) expire silently: no `lock.expired`.
- **Same-source supersede**: when a new Cline task starts (hook `TaskStart`/`TaskResume`, or the first event of an unseen Cline owner) or a new Claude session starts (`SessionStart`), the daemon (`POST /supersede {source, owner}`) releases the locks, waiters and presence of OTHER owners of the same source that have been idle for more than `supersedeIdleSeconds` (10): a crashed task never blocks its replacement. Owners active within that window are kept, so two real concurrent Cline windows still conflict. `lock.expired` with reason `superseded` is published only for locks that were visible.
- **Contention** (two live owners): priority, phase, aging and queue rules apply as before. Wait budgets: `maxWaitSeconds` (claude 8, cline 45, opencode 20), one budget per hook invocation counted from process start (stdin/emit overhead included), shared across all paths of the call.
- **Conflict policy (`onConflict`, per source)**: `claude` and `opencode` are `deny`: Claude gets a `permissionDecision: deny` and OpenCode a thrown Error, both tool errors the model reads and retries. `cline` is `wait`: Cline has no per-call deny. A `tool_call` hook answering `{cancel:true}` becomes a runtime stop that halts the WHOLE run and its reason never reaches the model (verified in extension 4.1.21/4.1.22). So the Cline hook blocks and polls up to 45s (Cline's own hook timeout is 120s, `toolCallTimeoutMs ?? 12e4`; a timeout would fail open anyway). If the lock frees it proceeds with `{cancel:false}`. If the budget expires while the holder is still live it STILL proceeds with `{cancel:false, context:"Warning: ..."}` (the model is told another tool is editing the feature), publishes `lock.override` (reason `wait-expired`) for the HUD and logs decision `override`. The Cline hook never prints `cancel:true`, whatever the config says. `OFFICE_MAX_WAIT_SECONDS` overrides the budget (tests).
- **Circuit breaker**: after `breakerDenials` (2) denial episodes of the same owner+feature within `breakerWindowSeconds` (60), the third attempt is allowed even if the holder is live (polls of one waiting episode count once): the call is allowed and a `lock.override` event shows a warning in the HUD. The lock is not stolen; the counter resets on grant/release.
- **`bridge/hook.log`**: one JSONL line per write-claim decision (`granted|denied|failopen|override`, `waitedMs`) and per hook invocation (`durMs`); rotates to `hook.log.1` above 512KB; git-ignored. Use it to verify real Cline/Claude behavior.

### Try the lock demo

Simulates Claude Code, Cline and OpenCode agents contending for features through the real write-lock coordinator (Claude/Cline via the real `bridge/hook.mjs`, OpenCode via `emit.mjs` claim/release). No files are written.

```bash
cd .opencode/visualizer && npm run dev      # http://localhost:5173 (daemon on ws://localhost:4777 auto-starts)
node .opencode/bridge/demo-locks.mjs        # or: cd .opencode && npm run demo:locks -- --fast   (~12s instead of ~24s)
```

In the HUD watch `lock.acquired` / `lock.waiting` (with who it waits on) / `lock.released` per feature: Cline holds `garden`, OpenCode queues behind it, Claude takes `auth` immediately, then Cline waits on Claude for the shared `app_router.dart`; when Cline finishes, the high-priority OpenCode session gets `garden` before normal, and low goes last. The script prints a PASS/FAIL table and exits non-zero on failure. It also runs a `solo` scenario (Cline alone: no denial, no `lock.*` events) an `orphan` scenario (owner stops; the next owner proceeds after `liveSeconds`) and a `supersede` scenario (new Cline task proceeds at once after a crashed one) on a private daemon (port 4791, killed afterwards). It needs a daemon that has `/locks` (restart an old one).

## Event model

Every bridge message is one JSON event. Producers send it without `ts`/`eventId`; the daemon always assigns both (a producer-supplied value is overwritten, so ordering and identity cannot be spoofed). `eventId` is `<boot>-<seq>`: unique per daemon run, `seq` strictly increasing; a replay whose first `seq` is above 0 means older history was dropped.

Types: `prompt`, `dispatch`, `handback`, `activity`, `busy`, `idle`, `error`, and the lock events `lock.acquired`, `lock.waiting`, `lock.released`, `lock.expired`, `lock.override`.

| Field | Notes |
| --- | --- |
| `type`, `agent` | Required (events missing either are dropped). `agent` is the sender, except `prompt` (receiver of the user's prompt). |
| `ts`, `eventId` | Daemon-assigned (ms epoch, `<boot>-<seq>`). |
| `sessionID`, `owner` | Routing ids (`claude:<id>`, `cline:<task>`, OpenCode session id; `owner` is the lock key). |
| `source` | `opencode`, `claude` or `cline`. |
| `target` | `dispatch`: receiving subagent. `handback`: the parent that gets the report. |
| `text` | Short label. `reason` is an optional short string (e.g. `wait-expired`, or `subagent-stop` on an `idle`). |
| `prompt`, `result` | Full text (Chat View thread). |
| `error` | Failure text of a failed `handback`. |
| `status` | `handback` outcome: `ok`, `error`, `interrupted` or `unknown`. |
| `toolName` | Set on `error` events caused by a failing tool (see "tool-error badge"). |
| `correlationId` | Links a `dispatch` to its `handback`: `claude:<tool_use_id>`, `opencode:<childSessionID>`. |
| `childSessionID`, `requestedAgent` | OpenCode child session; the raw subagent type when it was relabelled (unknown types become `scout`). |
| `durationMs` | Task duration reported by the producer. |
| `feature`, `priority`, `phase`, `waitingOn{source,sessionID,feature}` | Lock events. |

`idle` with `reason:"subagent-stop"` is Claude Code's `SubagentStop` without `agent_type`; it is labelled `orchestrator` but must not settle the orchestrator's other dispatches (the Chat View ignores it for delivery status).

Limits (daemon `sanitize`): `prompt`/`result` 4000 chars, `error` 1000, every other string field 200 (unknown extra fields are masked but not clipped); `durationMs` kept only if a finite number in `0..86_400_000`; request body 64 KB. Replay buffer: last 500 events and at most 600 KB serialized, oldest evicted first. Strings are masked before they are clipped.

## Secret masking

`bridge/mask.mjs` is best-effort and conservative (over-masking is fine, leaking is not). It is browser-safe and imported by every layer:

- **Producers**: `hook.mjs` and `office-bridge.ts` mask descriptions and `prompt`/`error`/`result` (`truncate` and `clipMasked` mask first). For `bash` only the binary name is logged.
- **`emit()`**: masks `text`, `prompt`, `result`, `error`, `reason` again as a backstop.
- **Daemon `sanitize`**: `maskDeep` over the whole event, then per-field `clipMasked`.
- **UI**: the chat store runs `maskDeep` on every incoming event; the thread panel masks prompt/result/error and the raw payload again; search runs over the stored (masked) values.

Order matters: mask first, clip second, because a token cut at the boundary would no longer match its pattern. Patterns (high level): PEM private keys, `Authorization`/`Bearer` values, URL credentials, secret query params (`token`, `key`, `sig`, ...), well-known token prefixes (`sk-`, GitHub, GitLab, Slack, AWS, Google, npm), JWTs, and `key=value`/`"key":"value"` for secret-looking keys (password, secret, token, api key, cookie, session id, credential, ...). `maskDeep` also replaces any value under a secret-looking key, recursing to depth 8 (deeper or cyclic parts become `[…]`).

Exempt keys (routing ids, never masked even though the name looks secret): `sessionID`, `childSessionID`, `correlationId`, `eventId`, `owner`.

Known gaps:

- `agent` and `source` of `POST /claim` lock events are not masked (only clipped); ids (`sessionID`, `owner`, `waitingOn.sessionID`) get a plain clip by design.
- Unknown extra fields are masked but not length-limited.
- Regex masking cannot catch every secret format; do not rely on it for secrets in free text.

## Agent Chat View

A read-only monitor of agent-to-agent traffic, opened with the toggle at the bottom of the page or `?view=chat`. Header: connection state, event count, and chips for parse errors and "older history dropped".

- **Channel list (left)**: `All Agents`, then pinned channels `orchestrator`, `scout`, `architect`, `coder`, `reviewer`, `memory-manager` (scout is pinned because the bridge relabels unknown subagent types to it, so it is often the busiest), then any other observed agent ids. Each channel shows task status, unread count (99+ cap), last task, message count, last time, `requested as:` aliases and a tool-error badge.
- **Feed (middle)**: messages grouped by sender, newest at the bottom, 500 rows per page (`Show more`), auto-follow with a "Jump to latest" pill. Each row: time, route (`→ receiver`), type badge, summary, short correlation id (click to isolate the task), reply count, status, duration.
- **Thread panel (right)**: the task's `dispatch` as root, linked events in time order (same `correlationId`, plus OpenCode child-session events), full prompt/result/error, collapsible metadata and masked payload JSON.
- **Filters and search**: free text over text/prompt/result/error/agent/target/requestedAgent/ids/toolName; sender, receiver, status (`pending|ok|error|interrupted|unknown`), kinds (`prompt|dispatch|handback|error|activity|lifecycle|lock|other`, default `prompt,dispatch,handback,error`), time presets (all time, 5 min, 15 min, 1 h, 24 h; refreshed every 30 s), and a per-task isolate chip.
- **States**: connecting, live but empty, offline with cached events (retry every 2 s), demo banner, no-match with `Clear filters`.

Three separate indicators, never merged:

1. **Task status** (per agent, lifecycle only): `working` on prompt/busy/received dispatch; `done` on idle after working, or a handback `ok`; `error` on a handback `error` or an `error` event without `toolName`; otherwise `unknown`.
2. **Delivery status** (per dispatch): `pending` until a handback with the same `correlationId` arrives, then that handback's status. If the dispatcher goes idle after the dispatch with no handback, or there is no `correlationId`, it is `unknown`.
3. **Tool-error badge**: an `error` with `toolName` only increments the agent's tool-error counter (reset when a new task starts); it never turns the task status to `error`.

Rule: **unknown without evidence**. Nothing is shown as `ok`/`done` unless an event proves it; a background Claude Task (handback `unknown`) shows no duration.

Ordering and dedupe: events are keyed by `eventId` (fallback: a content fingerprint) so reconnect replays merge instead of duplicating; sorted by `(ts, arrival order)`; a missing, non-positive, non-finite or more-than-5-minutes-in-the-future `ts` is flagged `ts?` and ordered by arrival time. Duration is the producer's `durationMs`, else `handback.ts - dispatch.ts` for the same `correlationId`. Unread counting starts after the first replay (history is not news).

Caps: the browser keeps the latest 2000 events. Scripted demo events (no `source`, `demo-*` session) are filtered out, and the demo never feeds the chat store; in demo mode the Chat View shows a banner and only real bridge events.

**Read-only guarantee**: the view has no input box and no write path. The browser only receives from the WebSocket, the daemon ignores client frames, and the only `prompt` events come from the OpenCode, Claude Code and Cline producers.

### Capability matrix

| | Claude Code | OpenCode | Cline |
| --- | --- | --- | --- |
| `prompt` | `UserPromptSubmit` (harness-injected turns skipped) | `session.inbox.enqueued` (user items) | `UserPromptSubmit` |
| `dispatch` | `PreToolUse` of Task/Agent, with `prompt`; unknown subagent types become `scout` + `requestedAgent` | child `session.created` (title as text, no prompt) | none |
| `handback` | `PostToolUse` Task/Agent: `ok` + `result` + `durationMs`; failure: `error` + `error` text; background Task: `unknown`, no result, no duration | child session end: `ok`/`error`/`interrupted`, `durationMs`, `error` text, no result text | none |
| `correlationId` | `claude:<tool_use_id>` | `opencode:<childSessionID>` (+ `childSessionID`) | none |
| Tool errors (`error` + `toolName`) | `PostToolUseFailure`, all tools | `tool.execute.after` with error status | `PostToolUse` failure |
| Sub-agent label | roster name from `agent_type`, else `scout` | session agent | any sub-agent (`parent_agent_id`) is always `scout` |

Not captured by any tool: successful tool results (there is no `tool.result` event). Cline workflows run the real roster through `bin/oc`, so the dispatches/handbacks of those runs appear as OpenCode events.

## Limitations and known gaps

- History is in memory only: the daemon's replay buffer is lost on daemon restart, the browser store on page reload. The Chat View shows "older history dropped" when the replay does not start at `seq` 0.
- Restart the daemon after upgrading `bridge/`: a running old daemon keeps serving the old behavior (stop the process listening on 4777; the next event auto-starts a new one).
- Claude Code payload fields `tool_use_id`, `tool_response.totalDurationMs` and `tool_input.run_in_background` are not verified against a live Claude Code run (without `tool_use_id` there is no `correlationId`, so dispatches stay unlinked).
- `plugins/office-bridge.ts` is only typechecked; its runtime behavior is not covered by an automated test.
- There are no browser/UI automated tests; only the store, reducers and bridge are tested.
- Pre-existing: the Workflow reducer in `visualizer/src/office.ts` reads `action.event.agent` without a null check, so a `null` entry inside a `hello` replay would throw. A top-level `null` WebSocket message never reaches it (`useOfficeStream` counts it as a parse error).
- Cline has no dispatch/handback and labels sub-agents `scout`; OpenCode handbacks carry no result text.

## Testing

```bash
node --test .opencode/bridge/test/*.test.mjs      # Node 22 rejects a directory argument; use the glob
cd .opencode/visualizer && npm test               # node --test test/*.test.mjs
cd .opencode/visualizer && npm run build          # tsc --noEmit && vite build
cd .opencode/visualizer && npx tsc --noEmit       # typecheck only
.opencode/node_modules/.bin/tsc --noEmit -p .opencode/tsconfig.json   # plugin + .d.mts typecheck
```

Last reported counts: bridge 187 tests, visualizer 83 tests (not re-run when this section was written).

| Suite | Covers |
| --- | --- |
| `bridge/test/coordinator.test.mjs` | Lock contention, paths/features, reentrancy, priority/aging/queue, breaker |
| `bridge/test/supersede.test.mjs` | Same-source supersede, silent locks, dead waiters |
| `bridge/test/qa-adversarial.test.mjs` | Solo mode, liveness, breaker semantics, caps |
| `bridge/test/daemon.test.mjs` | HTTP claim/release, guards (host/origin/size), presence, event envelope |
| `bridge/test/hook.test.mjs` | Deny payloads, release, fail-open, `hook.log`, Claude dispatch/handback |
| `bridge/test/hook-cline-sdk.test.mjs` | Cline SDK hook names and payloads |
| `bridge/test/mask.test.mjs` | `mask`, `maskDeep`, `clipMasked` |
| `bridge/test/chat-e2e.test.mjs` | hook -> daemon -> WebSocket -> chat store (no browser), envelope masking, replay cap |
| `visualizer/test/model.test.mjs` | Chat store: dedupe/merge, ordering, duration/delivery, task status, filters, guards |
| `visualizer/test/chat-stage4.test.mjs` | Filter+search combos, 2000+ events, incomplete/duplicate events, task flows, timestamps, nested masking |
| `visualizer/test/office-regression.test.mjs` | Workflow reducer unchanged by the new event types |

## Roadmap / next steps

- Optional persistence of the event history (file or SQLite) so a daemon restart or page reload does not lose it.
- Capture `tool.result` (successful tool output, masked and clipped) for tool calls.
- Browser/UI automated tests for the Chat View.
- Cline dispatch/handback support (and real sub-agent labels instead of `scout`).
- Verify `tool_use_id`, `totalDurationMs` and `run_in_background` against a live Claude Code session; add a runtime test for the OpenCode plugin.
- Fix the null-event crash in `office.ts`.

## Security Notes

- Never commit API keys, tokens, signing keys, or credentials.
- Prefer environment variables for provider credentials.
- Keep write/edit permissions limited to agents that need them.
- Route auth, token, signaling, and P2P tasks through security-oriented skills and the `security` agent.

## Troubleshooting

### opencode fails to start after config edit

Use one of these escape hatches:

```sh
OPENCODE_DISABLE_PROJECT_CONFIG=1 opencode
```

or:

```sh
OPENCODE_CONFIG=/path/to/known-good-opencode.json opencode
```

Fix invalid config, then restart normally.

### Agents or skills do not update

Restart opencode. Config, agents, skills, plugins, and MCP definitions are loaded once at startup.

### The visualizer or Agent Chat View stays empty / offline

1. `curl http://localhost:4777/health` should answer `{"ok":true,...}`. If it answers `office-bridge ok` instead, an old in-process bridge holds the port: quit that OpenCode instance, stop the process on 4777 and send any event so a fresh daemon starts.
2. Make sure `OFFICE_BRIDGE` is not `off` and the page uses the same port (`?bridge=ws://localhost:<port>` when `OFFICE_BRIDGE_PORT` is set).
3. After upgrading `bridge/`, restart the daemon (and OpenCode).
4. Check `bridge/hook.log` (and `bridge/hook-shell.log` for Cline) to see whether hooks fired; Claude Code needs `../.claude/settings.json`, Cline runs the scripts in `../.clinerules/hooks/`, which need `node` on the PATH (the scripts add common locations such as Homebrew and nvm).
5. "older history dropped" in the Chat View is expected after a daemon restart or when more than 500 events / 600 KB were produced.

### `node --test .opencode/bridge/test` fails on Node 22

Node 22 rejects a directory argument; pass the glob `.opencode/bridge/test/*.test.mjs`.

### Agents or skills missing in Claude Code / Cline

Run `node .opencode/bridge/sync.mjs`; it regenerates `.claude/` and `.clinerules/workflows/` (not `.claude/settings.json`).

### Model not found or provider authentication fails

Check:

1. 9Router API key is exported in the same shell that starts opencode.
2. Model IDs match valid 9Router model aliases.
3. Provider/base URL configuration matches current 9Router documentation.
4. No API key is hardcoded or accidentally committed.
