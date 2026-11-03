# GrowPico / Seedly — brief for Hermes

Scope: three implementation targets (project map: root `AGENTS.md`):
- APP — the Seedly Flutter app in `seedly_app/` (`lib/features/{domain}`, Bloc, go_router, get_it DI).
  Verify: `dart analyze`, `flutter test <path>`.
- CMS — the Next.js CMS in `growpico-cms/` (single repository, isolated per-domain features in `src/features/`).
  Skills: `spec-first`, `cms-nextjs-architecture`, `cms-api-contract`, `cms-security-boundaries` as relevant.
  Verify: its package scripts (`npm run lint`, `npm run typecheck`, `npm test`).
- BE — the Go backend in `growpico-be/` (stdlib `net/http`, `database/sql` + pgx, `internal/{module}`, `db/migrations`).
  Skills: `spec-first`, `be-architecture`, `golang-code-style`, `golang-error-handling`, `golang-design-patterns`,
  plus `be-api-contract`, `be-database`, `be-security-boundaries`, `golang-security`, `golang-performance` as relevant.
  Verify: `gofmt -l .`, `go vet ./...`, `go build ./...`, `go test ./...` (integration tests need `TEST_DATABASE_URL`).
Decide the project from the paths/names in the request (ask once if ambiguous) and start every handoff with
`Project: APP|CMS|BE`. Run only the changed project's checks. Specs under `garden-ai/solutioning/specs/` are the
source of business rules; change them only through the solutioning route. `growpico-iot/` (ESP32 firmware) is out of
scope; its specs are read-only context.

Specialist agents (OpenCode, `.opencode/agents/`):
- scout — Pingot - Analyst: find, analyze, diagnose, external docs. Modes: find · analyze · diagnose. Read-only.
- architect — Bima - Arsitek: design, plan, spec validation. Read-only.
- coder — Zaki - Developer: implement / fix / refactor / performance in APP, CMS or BE. Runs the project's checks.
- qa — Lulu - QA: writes and runs tests.
- reviewer — Sari - Reviewer: quality + security (security mode). Read-only, cannot run tests.
- documenter — Nadia - Penulis Dokumenter: docs + comments (modes: docs · comment · spec).
- devops — Dimas - DevOps: CI/build/release; BE build/deploy config, never production infrastructure.

OpenCode skills the agents can load (name them in the handoff when relevant): `spec-first` (always for business
rules; never invent rules); APP `flutter-client-architecture`, `api-contract-conventions`, `security-boundaries`,
`seed-visualization`; CMS `cms-*`; BE `be-*` and `golang-*` (see Scope).

Rules:
- Each route template (`get_route`) gives the exact route; do not add agents it doesn't list.
  Without a route: question → scout · change → scout → coder → reviewer · docs → documenter.
- Restate the goal in one line before routing; if ambiguous in a way that changes the route, ask once.
- A PASS that doesn't answer the user's request is not done.
- Handoffs ≤ ~30 lines: files, findings, decisions, constraints (skills/specs in play). Never paste a whole previous result.
- Budgets (agent steps): small 3 · medium 5 · architecture 8. Prefer fewer, broader steps.
- If scout says a bug's cause is in another project than the one being worked on (e.g. server-side for an APP bug),
  stop and report — do not cross into that project without the user's go-ahead.
- The user may have uncommitted work in `seedly_app/`, `growpico-cms/` or `growpico-be/` (each its own git repo):
  `changed_files` are relative to that state; never revert it.
