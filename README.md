# opencode Multi-Agent Workspace

This directory contains the project-local opencode setup for the **Seedly Flutter app** (`seedly_app/`). Seedly's broader system also includes a Go backend, ESP32 firmware, and a Next.js admin CMS, but this workspace only builds the Flutter client — it reads the other systems' specs for context (what APIs the app consumes) and never implements them.

**Orchestration is owned by Hermes** (Hermes Agent OS, `~/ferry-dev/hermes-agent-os`, Hermes profile `hermes-ferry`). Hermes plans every task, dispatches the specialist agents defined here through its OpenCode adapter (`opencode run --agent <specialist>`, one step at a time), runs the review loop, keeps the Knowledge Graph and writes the final answer. This directory provides the 7 specialist agents, the `hermes` front-door agent, 17 route templates (`commands/`), 5 domain skills, 9Router model routing for the agents, and the event/lock bridge with the visualizer (Workflow View + Agent Chat View). Cline submits to Hermes too; Claude Code is standalone (codes directly) and is only observed by the visualizer (see [Multi-tool setup](#multi-tool-setup-opencode--cline--claude-code)). End-to-end guide: `~/ferry-dev/hermes-agent-os/docs/E2E_GUIDE.md`.

## Directory Layout

```text
.opencode/
├── opencode.json              # default agent (hermes), disabled built-ins, global tool switches
├── coordination.json          # write-lock config (pathRules, wait budgets, onConflict, liveness)
├── tsconfig.json              # typechecks plugins/**/*.ts and bridge/**/*.d.mts only
├── agents/                    # one .md per agent (file name = agent name; keep it flat)
├── commands/                  # one .md per route template; Hermes reads them (also OpenCode slash commands)
├── hermes/brief.md            # project brief Hermes reads before planning (scope, roster, rules)
├── skills/                    # domain skills, loaded on demand by the specialist agents
├── bin/oc                     # submits work to Hermes from any shell / tool (OpenCode, Cline)
├── bridge/                    # tool-agnostic event/lock bridge (zero-dependency Node ESM)
│   ├── daemon.mjs             # owns ws://localhost:4777 + HTTP endpoints
│   ├── emit.mjs (+ .d.mts)    # client: POST an event (auto-starts the daemon), claim/release/supersede
│   ├── hook.mjs               # Cline / Claude Code hook payloads -> events + lock enforcement
│   ├── hook.sh                # shared launcher: resolves node (VS Code PATH has none) then execs hook.mjs
│   ├── mask.mjs (+ .d.mts)    # secret masking shared by producers, daemon and UI
│   ├── coordinator.mjs        # per-feature write locks (liveness, queue, breaker)
│   ├── sync.mjs               # generates the Cline workflows (submit to Hermes) + Claude Code agents/commands/skills
│   ├── demo-locks.mjs         # lock contention demo
│   ├── test/                  # node:test suites for the bridge
│   └── hook.log               # JSONL decision log (git-ignored)
├── plugins/
│   └── office-bridge.ts       # OpenCode -> bridge (events + write locks), tags events with the Hermes task id
├── visualizer/                # Vite + React app: Workflow View (3D office) and Agent Chat View
│   ├── src/chat/              # Agent Chat View (model.mjs store + ChatView/RoomList/Timeline/DetailPanel)
│   └── test/                  # node:test suites for the chat store and the workflow reducer
├── archive/agents-v1/         # previous 19-agent setup, kept for reference (not loaded)
├── package.json
└── package-lock.json
```

Outside this directory, the same setup is wired into the other tools: `../AGENTS.md` and `../CLAUDE.md` (instructions), `../.claude/` (hand-written `settings.json` with the visualizer hooks, generated `agents/` + `commands/`, the `skills` symlink; Claude Code does not use Hermes or 9Router), `../.clinerules/` (Cline hooks and generated workflows, plus `no-polling-loops.md`).

> Agent files must sit directly in `agents/`. opencode names nested files by path (`subagents/research/scout`), which breaks `agent:` references in commands.

## Agent Model

Hermes is the orchestrator (outside OpenCode). Here: seven specialist subagents that Hermes dispatches one step at a time, plus `hermes`, the OpenCode front door. Every definition (model, tools, prompt) lives in its `.md` frontmatter only.

| Agent | Name | Role | Model |
| --- | --- | --- | --- |
| `hermes` (primary, default) | Hermes | Front door: submits every message / slash command to Hermes via `bin/oc` and relays the answer. Never dispatched by Hermes. | `ninerouter/researcher-fast` |
| `scout` | Pingot | Read-only: find files/patterns, analyze flow and impact, diagnose root causes, external docs | `ninerouter/researcher-deep` |
| `architect` | Bima | Read-only: design, implementation steps, spec/business-rule validation | `ninerouter/planning-architect` |
| `coder` | Zaki | Implement / fix / refactor / performance changes in `seedly_app/` | `ninerouter/implementation-high` |
| `qa` | Lulu | Write and run tests only | `ninerouter/quality-safer` |
| `reviewer` | Sari | Read-only review incl. security checks | `ninerouter/quality-high` |
| `documenter` | Nadia | Docs, solutioning docs (targeted README/CHANGELOG updates), code comments | `ninerouter/documentation-low` |
| `devops` | Dimas | CI/build/signing/release tooling | `ninerouter/infrastructure-high` |

The former `orchestrator` (Risko) and `memory-manager` (Arsa) agents were removed: Hermes now does their jobs (routing/review loop, Knowledge Graph reads and writes). Their prompts are in the pre-migration backup and in git history.

Each agent file opens with a short **Soul**: a name, a character, and the habits that keep it from making mistakes. Each file's heading is `# <Nama> - <Peran>` (e.g. `# Pingot - Analyst`); the visualizer reads name and role from that heading (the standing orchestrator character uses `agents/hermes.md`).

opencode's built-in `general` and `explore` subagents are disabled in `opencode.json`.

## Tool Permission Pattern

- `scout`, `architect`, `reviewer`: read-only (`scout` also has `webfetch`).
- `coder`, `qa`, `devops`: write + bash. `documenter`: write, no bash.
- `hermes`: shell + read only, `task: false` (cannot delegate inside OpenCode). OpenCode v2.0.28 cannot restrict shell by command pattern (a `permission.bash`/`permission.shell` deny-all removes the tool), so the restriction to `bin/oc` is by prompt.
- Every specialist has `task: false`: Hermes is the only one that routes. Do not set `read: false` on an agent — on OpenCode v2.0.28 that silently switches the run to OpenCode's free-tier model.
- `hermes-memory_*` tools are off for every agent here (`opencode.json`); only Hermes writes the Knowledge Graph.

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
| `cms-nextjs-architecture` | GROWPICO CMS (`growpico-cms/`, Next.js App Router): scaffold commands, folder layout, Server/Client rules, domain → route → spec → contract map, build order. |
| `cms-ui-slicing` | Slicing CMS screens from PNGs in `growpico-cms/design/`: region mapping, shared components, Tailwind v4 tokens, per-screen Definition of Done. |
| `cms-api-contract` | CMS calls to `/v1/admin/*`: conventions, error envelope, `reason`/`auditId`, contract → types/Zod/adapter/mock procedure, mock vs go adapter. |
| `cms-security-boundaries` | CMS auth and secrets: iron-session cookie, server-only Go calls, `proxy.ts` redirect, cosmetic RBAC, mock-mode guard, open decisions. |

Skills are loaded on demand by the specialist agents; Hermes names the relevant ones in each handoff. `spec-first` holds the keyword → spec file map, so specs are opened selectively instead of reading the ~690 KB spec tree.

## Command Workflows (route templates)

Each file in `commands/` is a route template with `agent: hermes`. In OpenCode it is a slash command handled by the `hermes` front door; Hermes itself reads the same file (`get_route`, or embedded by `bin/oc`) and follows its route.

| Route | Route |
| --- | --- |
| `feature` | small: `scout → coder → reviewer` · medium: `+ qa` · architecture: `scout → architect → coder → reviewer → qa` |
| `bugfix` | `scout (diagnose) → coder (fix) → reviewer` (+ `qa` if business logic changed) |
| `refactor` | `scout → coder → reviewer` (+ `qa` if large) |
| `review` | `reviewer` |
| `security` | `reviewer` (security mode); `coder → reviewer` only if fixes are requested |
| `performance` | `scout → coder → reviewer` |
| `document`, `comment` | `documenter` |
| `devops` | `devops → reviewer` |
| `analyze` | `scout` (+ `architect` for design questions) |
| `solutioning` | doc-only: `documenter` · spec/design: `architect → documenter` (only if files change) |
| `memory`, `memory-status`, `memory-search` | Hermes answers from the Knowledge Graph (read-only) |
| `compact`, `forget` | Hermes proposes changes and asks before writing/deleting |
| `help` | static list |

### Workflow Rules (enforced by Hermes)

- Handoffs between steps are summaries (≤ 30 lines), never full outputs.
- Reviewer `FAIL` → coder gets only `REQUIRED_FIXES`; max 2 rounds, then Hermes pauses for you.
- At most one retry per failed step; OpenCode never retries on its own.
- Knowledge is written only by Hermes, only when reusable (decision, root cause, gotcha, pattern), tagged `[project:growpico]` with provenance.

### Memory

Canonical Knowledge Graph (since 2026-10-21): `~/.hermes/profiles/hermes-ferry/memories/mcp/knowledge.json`, owned by the `hermes-ferry` profile. Hermes reads it before planning and writes it after the work through its `memory` MCP server; relevant findings reach the agents inside the handoff. The former `plugins/memory-recall.ts` (passive keyword recall for orchestrator/documenter) was removed as a duplicate of Hermes' recall.

Legacy file: `~/.hermes/profiles/rtdigital/memories/mcp/knowledge.json` still exists and is still read through the **global** OpenCode MCP server `hermes-memory` (`~/.config/opencode/opencode.jsonc`). It is frozen, not synchronised: nothing copies between it and the canonical file, and there is **no single source of truth** until the OpenCode consumer path through Hermes exists. Do not claim the two are in sync.

Provenance is convention metadata, not enforcement. `[project:<scope>]` and `area:app|be|iot` live as text in an entity's observation; `@modelcontextprotocol/server-memory` has no tag field, `search_nodes` matches them as plain text only, and `open_nodes` cannot filter by them. Known scopes: `growpico` (areas `app`, `be`, `iot`), `rt-rw`, `shared`, `pasconnect`, `gts`, `unclassified`. Only `growpico` is a registered `project_id` in `hermes-agent-os/projects/`; `pasconnect` and `gts` are knowledge classifications, not dispatchable projects.

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

9Router runs locally (`http://localhost:20128/v1`). The `ninerouter` provider is defined in the global `~/.config/opencode/opencode.jsonc`; its API key is stored by OpenCode in `~/.local/share/opencode/auth.json` (`opencode auth`). Hermes uses its own copy of the key in `~/.hermes/profiles/hermes-ferry/.env` (`NINEROUTER_API_KEY`). Never commit keys.

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

Events reach the page from the bridge daemon on `ws://localhost:4777` (`plugins/office-bridge.ts` for OpenCode, `bridge/hook.sh` → `bridge/hook.mjs` for Claude Code and Cline; see [Multi-tool setup](#multi-tool-setup-opencode--cline--claude-code)).

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

`.opencode/` stays the single source of truth; see `../AGENTS.md` for the short version. OpenCode and Cline are clients of Hermes; Claude Code is standalone (its own session orchestrates the same specialists as Claude Code subagents on Claude models) and feeds the visualizer.

### How each tool reaches Hermes

| Tool | Trigger | Visualizer feed |
| --- | --- | --- |
| Hermes | `hermes -p hermes-ferry -s agent-os-orchestrate` or `bin/oc <route> "<request>"` | Hermes shell hooks + adapter (`agent: hermes`, `taskId`) |
| OpenCode | Default agent `hermes` relays every message and slash command to Hermes via `bin/oc`. | `plugins/office-bridge.ts` |
| Claude Code | Standalone: does not submit to Hermes (no `oc` permission, no 9Router). The session orchestrates the specialists itself via `../.claude/commands/<route>.md` and `../.claude/agents/<name>.md` (Claude models). | `bash bridge/hook.sh claude` via `../.claude/settings.json` |
| Cline | Workflows in `../.clinerules/workflows/` submit to Hermes via `bin/oc`. | `bridge/hook.sh cline` via `../.clinerules/hooks/<Event>` (no extension) |

`bin/oc` (wraps `hermes-agent-os/bin/hermes-task.mjs`): `oc <route> "<request>"`, `oc ask "<request>"`, `oc agent <name> "<task>"`, `oc routes`; add `--async` to get a task id, then `oc wait <task_id>`. The request can come on stdin (quoted heredoc) so user text is never shell-interpolated. One chat = one Hermes task: follow-up messages are turns of the same task (OpenCode's `$OPENCODE_SESSION_ID`, or `--task <task_id>` from Cline/shell) and Hermes resumes its own session; `--new` starts a separate task, `oc status <task_id> --turn N` shows an earlier turn.

### `bridge/sync.mjs`

`node .opencode/bridge/sync.mjs` regenerates (re-run after editing `agents/` or `commands/`):

- `../.clinerules/workflows/*.md`: one thin "submit this route to Hermes" file per route.
- `../.claude/skills`: a symlink to `.opencode/skills`.
- `../.claude/agents/*.md`: the 7 specialists as Claude Code subagents (not `hermes`). Body = the OpenCode persona minus OpenCode-only lines; tools mapped from the `tools:` block (+ `Skill`); model from `CLAUDE_MODELS` in `sync.mjs` (scout/qa/devops sonnet, architect/coder/reviewer opus, documenter haiku).
- `../.claude/commands/*.md`: the agent routes as Claude Code slash commands that the Claude session orchestrates with the Agent tool (no Hermes). Knowledge Graph routes (`memory*`, `compact`, `forget`) and `help` are not generated (Hermes-only, or shadow Claude Code built-ins); `Memory:` lines are dropped.
- It removes stale generated Claude files (`../.claude/hermes.md`, `../.claude/orchestrator.md`).

Generated files start with a `GENERATED by .opencode/bridge/sync.mjs` marker; stale generated files are removed, hand-written ones never are. **`../.claude/settings.json` (visualizer hooks) is NOT generated**; edit it by hand. Likewise `../.clinerules/hooks/<Event>` and `no-polling-loops.md` are hand-written.

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
- **`bridge/hook.sh <cline|claude> [Event]`**: launcher used by both tools. Resolves `node` (`$OFFICE_NODE`, PATH, `~/.hermes/node/bin`, Homebrew, `/usr/local`, newest nvm), appends a breadcrumb (`.opencode/bridge/hook-shell.log`) and `exec`s `bridge/hook.mjs "$@"`. No node found: exits 0, printing `{"cancel":false}` for Cline (never blocks a tool call).
- **`bridge/hook.mjs <cline|claude>`**: reads the hook payload on stdin, always exits 0, emits events (see the per-tool matrix below) and enforces write locks. Claude Code hooks registered in `../.claude/settings.json` run `bash "$CLAUDE_PROJECT_DIR/.opencode/bridge/hook.sh" claude`: `SessionStart`, `UserPromptSubmit`, `PreToolUse` (all tools), `PostToolUse` (only `Task|Agent`), `PostToolUseFailure` (all tools), `SubagentStop`, `Stop`, `SessionEnd`. Cline hooks in `../.clinerules/hooks/`: `TaskStart`, `TaskResume`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `TaskComplete`, `TaskCancel`, `TaskError` (each script is `<Event>` with no extension — what Cline 4.1.x looks for — and calls `hook.sh cline <Event>`, falling back to `{"cancel":false}`).
- **`plugins/office-bridge.ts`**: OpenCode plugin (v2 plugin API). Turns session/tool events into bridge events and claims write locks before `edit`/`write`/`patch`; denial is a thrown Error, daemon trouble fails open.
- **`bridge/coordinator.mjs`**: the write-lock logic used by the daemon (see [Feature write locks](#feature-write-locks)); configured by `coordination.json` (`OFFICE_COORDINATION` overrides the path).
- **`bridge/hook.log`**: see below. `OFFICE_HOOK_LOG` overrides its path. The launcher `bridge/hook.sh` also appends a breadcrumb per invocation to `bridge/hook-shell.log` (`OFFICE_HOOK_SHELL_LOG` overrides; capped at ~200 KB; git-ignored): timestamp, tool source, event and the resolved node.
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

- **Channel list (left)**: `All Agents`, then pinned channels `orchestrator` (Hermes), `scout`, `architect`, `coder`, `reviewer` (scout is pinned because the bridge relabels unknown subagent types to it, so it is often the busiest), then any other observed agent ids. Each channel shows task status, unread count (99+ cap), last task, message count, last time, `requested as:` aliases and a tool-error badge.
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
- Cline has no dispatch/handback and labels sub-agents `scout`; OpenCode's own handbacks carry no result text (Hermes Agent OS handbacks do: `result`, `status`, `durationMs`).
- Hermes events use `agent: hermes` (shown as the orchestrator character) and carry `taskId`/`executionId`/`projectId`; OpenCode events of a Hermes-dispatched run carry the same ids.

## Testing

```bash
node --test .opencode/bridge/test/*.test.mjs      # Node 22 rejects a directory argument; use the glob
cd .opencode/visualizer && npm test               # node --test test/*.test.mjs
cd .opencode/visualizer && npm run build          # tsc --noEmit && vite build
cd .opencode/visualizer && npx tsc --noEmit       # typecheck only
.opencode/node_modules/.bin/tsc --noEmit -p .opencode/tsconfig.json   # plugin + .d.mts typecheck
```

Last run (2026-10-20, Hermes Agent OS migration): bridge 188 tests pass, visualizer 101 tests pass, both typechecks clean.

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
- Route auth, token, signaling, and P2P tasks through the `security` route (reviewer in security mode, skill `security-boundaries`).

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
4. Check `bridge/hook.log` and `bridge/hook-shell.log` (both tools) to see whether hooks fired: the shell log proves the hook was launched and from which tool, and which node it resolved. Claude Code needs `../.claude/settings.json`, Cline runs the scripts in `../.clinerules/hooks/` — both go through `bridge/hook.sh`, which finds `node` even on the minimal PATH of a VS Code-launched tool.
5. "older history dropped" in the Chat View is expected after a daemon restart or when more than 500 events / 600 KB were produced.

### `node --test .opencode/bridge/test` fails on Node 22

Node 22 rejects a directory argument; pass the glob `.opencode/bridge/test/*.test.mjs`.

### Workflows or skills missing in Cline / Claude Code

Run `node .opencode/bridge/sync.mjs`; it regenerates `.clinerules/workflows/` and the `.claude/skills` symlink (not `.claude/settings.json`). The roster is not copied into Cline (it submits to Hermes) or Claude Code (standalone).

### Model not found or provider authentication fails

Check:

1. 9Router API key is exported in the same shell that starts opencode.
2. Model IDs match valid 9Router model aliases.
3. Provider/base URL configuration matches current 9Router documentation.
4. No API key is hardcoded or accidentally committed.
