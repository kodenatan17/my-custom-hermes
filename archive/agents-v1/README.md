# opencode Multi-Agent Workspace

This directory contains the project-local opencode setup for the **Seedly Flutter app** (`seedly_app/`). Seedly's broader system also includes a Go backend, ESP32 firmware, and a Next.js admin CMS, but this workspace only builds the Flutter client — it reads the other systems' specs for context (what APIs the app consumes) and never implements them. It defines specialized agents, domain skills, command workflows, and 9Router model routing.

## Directory Layout

```text
.opencode/
├── opencode.json              # Project opencode config and inline agent model/tool mapping
├── agents/
│   ├── core/                  # Primary orchestration agent
│   └── subagents/             # Specialized subagents grouped by capability
├── skills/                    # Project domain skills loaded by opencode
├── plugins/office-bridge.ts   # Streams agent activity to the office visualizer
├── visualizer/                # 3D office view of agents at work (Vite + React Three Fiber)
├── package.json               # Local plugin/dev dependency metadata
└── package-lock.json
```

## Agent Model

Agents are split by workflow responsibility. Each agent has a focused prompt, model, and tool permission set.

### Core Agent

| Agent | Purpose |
| --- | --- |
| `orchestrator` | Routes user commands to the correct workflow, selects agents, applies gates, and summarizes results. |

### Research Agents

| Agent | Purpose | Model |
| --- | --- | --- |
| `finder` | Fast repository scout. Finds files, symbols, patterns, and entry points. | `ninerouter/researcher-fast` |
| `analyst` | Analyzes structure, dependencies, execution flow, risks, and change impact. | `ninerouter/researcher-deep` |
| `researcher` | Uses external references and official documentation when needed. | `ninerouter/researcher-deep` |

### Planning Agents

| Agent | Purpose | Model |
| --- | --- | --- |
| `architect` | Designs maintainable mobile architecture, boundaries, and integrations. | configured in agent file/config |
| `planner` | Breaks architecture or feature design into executable tasks. | `ninerouter/researcher-fast` |

### Implementation Agents

| Agent | Purpose | Model |
| --- | --- | --- |
| `coder` | Creates new files, functions, classes, and features from plan/design. | `ninerouter/implementation-high` |
| `editor` | Modifies existing files and integrates changes. | `ninerouter/implementation-low` |
| `fixer` | Applies minimal bug fixes from diagnosis or known reports. | `ninerouter/implementation-low` |
| `refactorer` | Improves structure/readability without behavior changes. | `ninerouter/implementation-low` |

### Quality Agents

| Agent | Purpose | Model |
| --- | --- | --- |
| `reviewer` | Reviews code changes for correctness, maintainability, and consistency. | `ninerouter/quality-high` |
| `tester` | Verifies implementation with project-aligned tests and checks. | `ninerouter/quality-safer` |
| `debugger` | Investigates unknown bugs and identifies root cause. | `ninerouter/quality-high` |
| `security` | Audits security-sensitive code/configuration. | `ninerouter/quality-high` |

### Infrastructure and Documentation Agents

| Agent | Purpose | Model |
| --- | --- | --- |
| `optimizer` | Improves performance, memory usage, startup time, and efficiency. | `ninerouter/infrastructure-low` |
| `devops` | Handles CI/CD, release automation, build pipelines, and deployment workflows. | `ninerouter/infrastructure-high` |
| `documenter` | Creates and updates technical documentation and README files. | `ninerouter/documentation-low` |
| `commenter` | Adds concise code comments and inline documentation. | `ninerouter/documentation-low` |

## Tool Permission Pattern

Agents get only tools needed for their role.

- Discovery agents usually get `read`, `list`, `glob`, and `grep`.
- Analysis agents may get `lsp` for symbol/context lookup.
- Implementation agents get `write`, `edit`, and limited `bash`.
- Review/security agents are read-only.
- Documentation agents can write/edit documentation.
- External web access is restricted to `researcher` unless explicitly needed.

This keeps each agent scoped and reduces accidental edits.

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

Skills should be loaded only when the task matches their domain (the orchestrator's Spec & Skill Resolution step selects them — see `agents/core/orchestrator.md`). Always load `spec-first`; load the other 3 only as relevant.

## Command Workflows

Use slash commands to trigger predictable multi-agent workflows.

| Command | Workflow |
| --- | --- |
| `/feature` | `finder → analyst → researcher → architect → planner → coder → reviewer → tester → documenter` |
| `/bugfix` known issue | `finder → fixer → reviewer → tester` |
| `/bugfix` unknown issue | `finder → debugger → fixer → reviewer → tester` |
| `/refactor` | `finder → analyst → refactorer → reviewer → tester` |
| `/review` | `finder → reviewer` |
| `/security` | `finder → analyst → security → reviewer` |
| `/performance` | `finder → analyst → optimizer → reviewer → tester` |
| `/document` | `finder → documenter` |
| `/comment` | `finder → commenter` |
| `/devops` | `finder → analyst → devops → reviewer` |
| `/analyze` | `finder → analyst` |
| `/analyze deep` | `finder → analyst → researcher` |
| `/analyze architecture` | `finder → analyst → architect` |
| `/help` | Returns command, workflow, and skill help. |

### Workflow Gates

- `finder` always runs first.
- Code changes must pass `reviewer` and `tester`.
- Sensitive domains require `security`.
- Fail if `reviewer`, `tester`, or `security` returns `FAIL`.
- Use repository context only and avoid unrelated context.

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

Keep project agent models prefixed with `ninerouter/` in `.opencode/opencode.json` or agent frontmatter.

Example:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "ninerouter/solo-orchestrator",
  "agent": {
    "finder": {
      "mode": "subagent",
      "model": "ninerouter/researcher-fast",
      "description": "Fast repository scout. Finds files, symbols, patterns, and entry points."
    }
  }
}
```

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

Prefer file-based agents for non-trivial behavior.

Create:

```text
.opencode/agents/<group>/<agent-name>.md
```

Example:

```markdown
---
name: my-agent
description: Short trigger-focused description.
mode: subagent
model: ninerouter/implementation-low
permission:
  read: allow
  edit: ask
  bash: ask
---

Agent prompt goes here.
```

Rules:

- Use `mode: subagent` for workflow agents.
- Keep description concrete and trigger-focused.
- Grant only tools needed by the role.
- Do not put secrets in agent files.

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

A 3D "team room" showing agents at work while you prompt. Each subagent in `opencode.json` gets a desk, and the orchestrator walks to whichever desk it just delegated to. Bubbles show the running tool, and the whiteboard and cards show task status.

- `plugins/office-bridge.ts` is an opencode plugin (loaded automatically). It turns session/tool events into simple events on `ws://localhost:4777`.
- `visualizer/` is a Vite + React Three Fiber app that renders the office.

```bash
cd .opencode/visualizer
npm install
npm run dev        # open http://localhost:5173 (add ?demo for the scripted demo)
```

Then run `opencode` in this project as usual. Options:

| Env / param | Effect |
| --- | --- |
| `OFFICE_BRIDGE=off` | Disable the plugin |
| `OFFICE_BRIDGE_PORT=4778` | Change the WebSocket port (then open the page with `?bridge=ws://localhost:4778`) |
| `PERSONAS` in `visualizer/src/agents.ts` | Give agents display names, e.g. `{ finder: "Pingot" }` |

Idle agents don't just sit: they wander off to the coffee bar (stools, standing table, barista) or play PS5 on the sofa, and walk back to their desk when they get a task. Tune how often in `visualizer/src/useIdleActivities.ts`, and add hang-out spots in `visualizer/src/spots.ts`.

At prayer time the free agents walk to the musholla and pray together: imam at the front (the orchestrator when it's free), makmum filling the saf from the middle out, with the correct number of rakaat. They wait for iqamah first, and Friday has a short khutbah before Jumat. Agents busy with a task join once they finish. Afterwards everyone goes back to what they were doing. Times are calculated locally with Kemenag parameters (Subuh 20°, Isya 18°, Ashar Syafi'i, +2 min ihtiyat); the default location is Jakarta.

| Param | Effect |
| --- | --- |
| `?lat=-7.25&lng=112.75&city=Surabaya` | Prayer times for another location |
| `?sholat=ashar` | Start a test prayer immediately (or press **Tes sholat** in the HUD) |
| `?sholat=ashar&sholatT=70` | Start the test 70 s in, to jump to a specific position |

New agents added to `opencode.json` get a desk automatically; their color comes from their folder under `agents/subagents/`. Only the first running opencode instance owns the port.

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

### Model not found or provider authentication fails

Check:

1. 9Router API key is exported in the same shell that starts opencode.
2. Model IDs match valid 9Router model aliases.
3. Provider/base URL configuration matches current 9Router documentation.
4. No API key is hardcoded or accidentally committed.
