---
name: be-architecture
description: "growpico-be layout: net/http ServeMux, internal/ modules, pgx with WithTx, envelope, slog, jobs table, how to add a module."
---

# Skill: be-architecture

Load order: spec-first → **be-architecture** → be-api-contract (endpoints), be-database (SQL), be-security-boundaries (auth, secrets). Go style and error rules: golang-code-style, golang-design-patterns, golang-error-handling.

## Purpose

`growpico-be/` (Go module `github.com/kodenatan17/growpico-be`, workspace root `seedly/`) is the backend. The code is the reference. The earlier draft layout in `growpico-be/docs/DEVELOPMENT_PLAN_READY.md` (`cmd/worker`, `internal/modules/*`, Firebase) is stale and must not be followed. The spec copies `garden-ai/solutioning/specs/domain/be/BACKEND_ARCHITECTURE.md` and `architecture/be/ARCHITECTURE_DECISIONS.md` were synced to the code on 2026-11-02.

## When to Use

- Adding or changing a module, route wiring, middleware, config, the DB pool, or the entry point.
- Deciding where a piece of backend code belongs.

## When Not to Use

- Endpoint paths, bodies and error codes: `be-api-contract`.
- SQL, migrations, schema: `be-database`.
- Tokens, passwords, rate limits, secrets: `be-security-boundaries`.
- Flutter app or CMS: `api-contract-conventions`, `cms-nextjs-architecture`.

## Layout (verified 2026-11-02)

| Path | What it does |
|---|---|
| `cmd/api/main.go` | Entry point. slog JSON to stdout. `config.Load` → signal context → `database.Open` → `server.New` → `http.Server` → graceful shutdown (15 s) on SIGINT/SIGTERM. |
| `internal/config/config.go` | The only `os.Getenv` caller. Required: `DATABASE_URL`, `JWT_SECRET` (≥ 32 bytes). Optional: `PORT` (8080), `ACCESS_TOKEN_TTL` (15m), `REFRESH_TOKEN_TTL` (720h), `DB_MAX_CONNS` (8, range 1–50). |
| `internal/platform/database/database.go` | `sql.Open("pgx")`, pool limits, `DBTX` interface, `WithTx`. |
| `internal/platform/httpx/response.go` | Envelope, `APIError` and constructors, `WriteError`, `Handle`, `DecodeJSON` (1 MiB cap). |
| `internal/platform/httpx/middleware.go` | `RequestID`, `Recover`, `Logger`, `SecurityHeaders`, `Chain`, `ClientIP`. |
| `internal/platform/httpx/ratelimit.go` | In-memory sliding-window `Limiter` (per process). |
| `internal/auth/` | `password.go` (argon2id), `tokens.go` (HS256 access, opaque refresh), `service.go`, `store.go` (SQL), `handler.go` (routes and limiters), `middleware.go` (`Authenticate`, `Principal`). |
| `internal/account/` | `profile.go` (GET/PATCH profile), `errors.go`. SQL lives in the handler here, with no service or store split. |
| `internal/server/server.go` | The only wiring point. Builds the token manager, auth service, mux, `/healthz`, `/readyz`, registers modules, applies the middleware chain. |
| `internal/server/server_integration_test.go` | Integration tests (package `server_test`). Skipped unless `TEST_DATABASE_URL` is set. |
| `db/migrations/` | Dated SQL files, applied by hand (see `be-database`). |
| `docs/` | Working documents for this repo. |

Not in the repo: `cmd/worker`, `internal/modules`, Gin, Ent, Atlas, Asynq, Redis, Firebase. No CI workflow file was found in the repo file list.

## Request Path

- Middleware order, outermost first: `RequestID` → `Recover` → `Logger` → `SecurityHeaders` → mux (`server.go`).
- Public route: `mux.HandleFunc("POST /v1/account/auth/login", httpx.Handle(h.login))`.
- Protected route: `mux.Handle("GET /v1/account/profile", authenticate(httpx.Handle(h.get)))`, where `authenticate` is `authSvc.Authenticate`.
- Handlers have the signature `func(w, r) error` and are wrapped by `httpx.Handle`. Return `*httpx.APIError` for client errors. Any other error becomes `500 internal_error`, and the cause is logged with the request id.

## Conventions

- **Routing:** Go 1.22 ServeMux patterns with method (`"GET /v1/..."`). No path parameters exist yet.
- **Errors:** construct with `httpx.BadRequest / Unauthorized / Forbidden / NotFound / Conflict / Unprocessable / TooManyRequests / Internal(err)`. Wrap inside packages with `fmt.Errorf("...: %w", err)` (the current code does this in `database.go`, `tokens.go`, `password.go`).
- **Logging:** `log/slog` only. The access log line has `request_id`, `method`, `path`, `status`, `duration_ms`. Headers and bodies are never logged. Get the id with `httpx.RequestIDFrom(ctx)`.
- **Data access:** `database/sql` with the `pgx/v5` stdlib driver. Hand-written SQL with `$1` placeholders. No ORM.
- **Transactions:** `database.WithTx(ctx, db, func(tx *sql.Tx) error { ... })` commits on nil, rolls back otherwise, and re-panics after rollback. Store functions take `database.DBTX` so they run inside or outside a transaction (`createUser`, `newSession`).
- **Row locks:** refresh-token rotation locks the row with `SELECT ... FOR UPDATE` inside `WithTx` (`lockSessionByRefreshHash`).
- **Time:** services and the token manager take a `now func() time.Time` field so tests can inject a clock.
- **Config:** read only in `config.Load`. Validation errors are joined with `errors.Join`.
- **Request limits:** body 1 MiB; header 64 KiB; server timeouts read-header 10 s, read 20 s, write 30 s, idle 60 s. Pool: max open and idle = `DB_MAX_CONNS`, connection lifetime 30 min, idle 5 min.

## Adding a Module

1. Read the contract section first (`be-api-contract`), the module row in `garden-ai/solutioning/specs/domain/be/BACKEND_ARCHITECTURE.md` §6.2 (module list and status), and the namespace in `API_ARCHITECTURE.md` §9.3. Do not build from the flat map in §9.5 (superseded).
2. Create `internal/<module>/` with:
   - `store.go`: SQL functions that take `database.DBTX`. No HTTP types.
   - `service.go`: rules, validation, transactions (`WithTx`). Return `*httpx.APIError` for client errors.
   - `handler.go`: `type Handler struct{ svc *Service }`, `NewHandler`, and `Register(mux *http.ServeMux, authenticate func(http.Handler) http.Handler)`. Decode with `httpx.DecodeJSON`, reply with `httpx.JSON`.
   - Small modules may skip service and store, as `account` does: its `Handler` runs parameterized SQL directly in `profile.go` (`h.db.QueryRowContext`, `h.db.QueryContext`), with constraint mapping in `errors.go`. Mirror that only for a small read/update module. A module with business rules or multi-table writes uses the `auth` split (handler / service / store).
3. Wire it in `internal/server/server.go`: construct it, then call `Register`. Pass `authSvc.Authenticate` for protected routes.
4. Config: add a field to `config.Config` and `config.Load` only when needed, with validation. Then update `growpico-be/.env.example` and the README configuration table.
5. Tests: unit tests next to the code (existing: `auth/password_test.go`, `auth/tokens_test.go`, `httpx/ratelimit_test.go`). Add one flow to `server_integration_test.go`.
6. Schema: a new dated file in `db/migrations/` (see `be-database`).
7. Specs: `garden-ai/solutioning/specs/` is not edited from code work. `growpico-be/README.md` says proposals are copied to the specs by hand after approval.

## Build Order

Step numbers follow `growpico-be/docs/MINIMUM_STACK.md` §5 (the current build order), not the `DEVELOPMENT_PLAN_READY.md` Phases 0–6, which group and order the work differently (for example ingest is Phase 3 there, step 3 here). Status is from the code, not from either plan.

| Step | Scope | Status (2026-11-02) |
|---|---|---|
| 1 | Skeleton: server, config, slog, `/healthz`, DB pool, `WithTx`, initial migration | Done |
| 2 | Own auth: register, login, refresh, logout, profile | Done (integration-tested) |
| 3 | Devices: claim, provisioning, idempotent readings ingest (HMAC), liveness | Not started |
| 4 | Jobs worker loop, `evaluate-container` first | Not started (table exists, no worker code) |
| 5 | Containers, plants, species; then missions and the XP ledger | Not started |
| 6 | Growth checks, reports; photo upload only after the storage decision (M3) | Deferred |

Plan drift to keep in mind: `DEVELOPMENT_PLAN_READY.md` Phase 0 still names Firebase, `cmd/worker`, `internal/modules` and Fly/Upstash. Phase 6 lists the CMS admin API as "not in the MVP timeline", but `api_contracts_cms.md` marks those endpoints MVP. Treat this as an open decision, not a fact.

## Verification

Run from `growpico-be/`. There is no Makefile and no CI config in the repo.

```bash
gofmt -l .                 # prints nothing when clean
go vet ./...
go build ./...
go test ./...              # unit tests; integration tests skip without TEST_DATABASE_URL
TEST_DATABASE_URL='postgres://postgres:x@localhost:55432/postgres?sslmode=disable' go test -race ./...
```

- The integration tests write rows. Use a throwaway Postgres 16 with `db/migrations/20261005_01_initial_schema.sql` applied (README §Tests shows the Docker command). Do not point the tests at Aiven.
- The Go version is open: `go.mod` says `go 1.24.0`, `MINIMUM_STACK.md` §1 says 1.25.

## Open

- Go version (1.24 in `go.mod` vs 1.25 in `MINIMUM_STACK.md`).
- `google/uuid` is listed in `MINIMUM_STACK.md` §1 but is not a dependency. UUIDs come from `gen_random_uuid()`.
- The rate limiter is in-memory, so it is correct only for one instance.
- The `jobs` table exists, but no worker or scheduler code exists.

Related: `golang-design-patterns`, `golang-error-handling`, `golang-code-style` for Go structure and errors.
