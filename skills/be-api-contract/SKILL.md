---
name: be-api-contract
description: "Turn a growpico-be contract section into handler, service and store: envelope, real error codes, open contract questions."
---

# Skill: be-api-contract

Load order: spec-first → be-architecture → **be-api-contract** (plus be-security-boundaries for any auth work). Go error rules: golang-error-handling.

## Purpose

The backend contract is in `garden-ai/solutioning/specs/contracts/`. Only the Account section is implemented in `growpico-be`. Everything else is `planned` or `inferred`. This skill says what the code does today, how to add a section without inventing shape, and which questions are still open.

## When to Use

- Adding or changing an endpoint in `growpico-be/internal/*`.
- Checking whether a response field, status code or error code is real.
- Deciding whether a contract section is ready to build.

## When Not to Use

- Module layout and wiring: `be-architecture`.
- Table and migration questions: `be-database`.
- App-side calls (Flutter): `api-contract-conventions`. CMS-side calls: `cms-api-contract`.

## Source Hierarchy

| File | Covers | Status |
|---|---|---|
| `contracts/api_contracts_backend.md` §0 | Global rules: base URL, casing, headers, envelope | Source of truth |
| `contracts/api_contracts_backend.md` §1 | Account: register, login, refresh, logout, profile | Implemented |
| `contracts/api_contracts_backend.md` §2–§5 | Garden, Growth, Experience, AI | Planned or `(inferred)` |
| `contracts/api_contracts_backend.md` §6 | Open questions Q#1–42 | Read before building |
| `contracts/api_contracts_backend.md` §8 | App ↔ contract drift audit (2026-10-22) | Lists app calls with no contract entry |
| `contracts/api_contracts_cms.md` | `/v1/admin/*` (CMS) | Planned; no admin module exists |
| `contracts/api_contracts_iot.md` | Device surface (`/v1/garden/iot/*`, claim, readings) | Planned; no device module exists |
| `growpico-be/docs/CONTRACT_GAP_RESOLUTION.md` | Proposed defaults for 14 gaps | Proposals, not decisions |

The contract §6 note says only gap #5 (camelCase for plant and species responses) is applied. Items #1–4, #6–14 are proposals until the team answers.

## Implemented Endpoints (verified in code, 2026-11-02)

```
GET   /healthz                          200 data {"status":"ok"}     no DB access; enveloped like every route
GET   /readyz                           200 / 503 database_unavailable
POST  /v1/account/auth/register         201 token pair               public
POST  /v1/account/auth/login            200 token pair               public
POST  /v1/account/auth/refresh          200 token pair               public; body {"token": "rf_..."}
POST  /v1/account/auth/logout           200 {"isSuccess": true}      Bearer
GET   /v1/account/profile               200 profile                  Bearer
PATCH /v1/account/profile               200 {"id", "username"}       Bearer; body {"username"}
```

Not built: Google sign-in, forgot password, every Garden, Growth, Experience, AI, device and admin endpoint.

## Envelope (contract §0.3, implemented in `httpx/response.go`)

Success:
```json
{ "status": { "code": 200, "message": "Success" }, "data": { ... } }
```
Error (`data` is omitted):
```json
{ "status": { "code": 401, "message": "Access token is invalid or expired", "error": "invalid_token" } }
```

- `status.error` is an additive machine code. It is lowercase snake_case in the code (contract §0.1 says uppercase; see Q#36).
- `status.code` equals the HTTP status.
- JSON keys are camelCase (`accessToken`, `streakDays`, `iotId`). Stored enum values are uppercase (`SUSPENDED`, `ACTIVE`).
- Creates return 201. The code has no 204 response. Contract DELETE rows marked `(inferred)` (§2.6, §2.11) are not built.

## Request Rules (implemented)

- Body: JSON, max 1 MiB, unknown fields ignored (so the contract can grow additively).
- Malformed JSON → `400 invalid_json`. Empty body → `400 empty_body`.
- Auth: `Authorization: Bearer <access JWT>`. The refresh endpoint reads no Bearer header.
- `X-Request-Id`: a client value matching `^[A-Za-z0-9_-]{1,64}$` is kept, otherwise an id is generated (`httpx/middleware.go`). It is echoed in the response header. Not in contract §0.2; sources are `BACKEND_ARCHITECTURE.md` §6.6 and `api_contracts_cms.md` §0 header table (~line 28). The CMS spec says the value is a UUID; the code accepts any value matching the pattern above (UUIDs included). Do not tighten it to UUID-only without a decision.
- Firebase ID tokens are not accepted (contract §0.2).

## Pagination: not built

- No list endpoint exists yet. Do not add cursor pagination until contract Q#12 and Q#13 are answered. Lists the contract marks as not paginated (for example §2.4 List Containers, a bare array) follow the contract as written.
- App contract examples use `?cursor=&limit=20` and `{items, nextCursor}`. `API_ARCHITECTURE.md` §9.1 proposes `{items, nextCursor}` (CONTRACT_GAP #12, not agreed).
- The CMS contract uses offset paging: `?page=1&pageSize=20` (max 100) and `{items, page, pageSize, total}`. This conflicts with the app's cursor model. Not decided.

## Idempotency-Key: not enforced

- Contract §0.2 requires the header on app POST, PATCH and DELETE.
- No code reads it. The `idempotency_keys` table exists (PK `(user_id, idempotency_key)`, 24 h expiry per `DATABASE_DESIGN.md`).
- Do not add a middleware or a per-module check silently. Q#38 asks whether account mutations need it.

## Rate Limits (built, in-memory, per process)

| Route | Limit | Key |
|---|---|---|
| `POST /v1/account/auth/login` | 60 per 15 min | client IP (checked first) |
| `POST /v1/account/auth/login` | 10 per 15 min | normalised email |
| `POST /v1/account/auth/register` | 20 per hour | client IP |
| `POST /v1/account/auth/refresh` | 120 per 15 min | client IP |

Exceeding a limit returns `429 rate_limited`. App (120/min/user) and device (1 per 5 s) limits are not built.

## Error Codes the Code Returns

| Code | HTTP | Returned by |
|---|---|---|
| `invalid_json` | 400 | every JSON body |
| `empty_body` | 400 | every JSON body |
| `invalid_email` | 400 | register (must parse; ≤ 254 chars) |
| `invalid_password` | 400 | register (8–128 chars) |
| `password_mismatch` | 400 | register |
| `token_required` | 400 | refresh with an empty token |
| `invalid_username` | 400 | PATCH profile (3–30 letters, digits, `_`) |
| `invalid_credentials` | 401 | login. Same response for unknown email and wrong password. Also returned for a DELETED user on login, refresh and any Bearer route |
| `invalid_refresh_token` | 401 | refresh: unknown, expired, or already rotated/revoked |
| `missing_token` | 401 | any Bearer route, no header |
| `invalid_token` | 401 | bad signature, expiry, issuer, audience or subject |
| `session_revoked` | 401 | session missing, revoked or expired |
| `account_suspended` | 403 | login, refresh, any Bearer route while suspended |
| `email_taken` | 409 | register |
| `username_taken` | 409 | PATCH profile |
| `rate_limited` | 429 | register, login, refresh |
| `database_unavailable` | 503 | `/readyz` only |
| `internal_error` | 500 | any unexpected error (cause logged, not sent) |

Contract error lists for Garden, Growth and Experience (`container_not_found`, `quest_already_completed`, `insufficient_photos`, and so on) are not implemented.

## Account Response Shapes (implemented)

- Tokens: `{ "accessToken": "<JWT, 15 min>", "refreshToken": "rf_<base64url>" }`. The refresh token rotates on every refresh.
- Profile: `id`, `username`, `email`, `level`, `levelName`, `xp`, `streakDays`, `plants`. `plants` is `null` when the user has no containers. Each entry has `iotId` (the container id, see Q#42), `iotName`, `currentSeeds`, `seeds`. Soft-deleted rows are excluded.
- A DELETED user gets `401 invalid_credentials` on refresh and Bearer routes (the code's default branch in `checkStatus`), not `403`. A suspended user gets `403 account_suspended`. Both are listed in contract §1.4, §1.5 and §1.7.

## Procedure: Contract Section → Code

1. Read the section, its **Status** line, and every `(inferred)` marker. Check §6 for its Q#. If the Q# is open and the endpoint shape depends on it, stop and report. Do not decide it.
2. Take the path from the §0.1 namespace and the §7 tree. Do not build from the superseded flat map in `API_ARCHITECTURE.md` §9.5.
3. Define the request struct with camelCase `json` tags. Decode with `httpx.DecodeJSON`.
4. Validate in the service, returning `httpx.BadRequest("snake_case_code", "message")` and similar. Never return a raw database error.
5. Use `database.WithTx` for any write that touches more than one table.
6. Protected routes: `authenticate(httpx.Handle(h.fn))`. Take the user id from `auth.PrincipalFrom`, never from the body or path.
7. Reply with `httpx.JSON(w, status, data)`.
8. Add one flow to `server_integration_test.go`.
9. Report the spec path and section you built from. Do not edit `garden-ai/solutioning/` from code work.

## Open Contract Questions (§6, Q#35–42): do not decide silently

| Q# | Question | Current code behaviour |
|---|---|---|
| 35 | Host: `https://api.seedly.io/v1` (§0.1) or `api.growpico.io` (README, CONTRACT_GAP) | Host is not in code |
| 36 | Casing of `status.error`: contract says uppercase SNAKE_CASE; CONTRACT_GAP #14 proposes `UNAUTHORIZED` / `NOT_FOUND` | Lowercase snake_case |
| 37 | 13+ age gate at signup: field on register, or a separate step? | `age_gate_confirmed_at` never set |
| 38 | `Idempotency-Key` on register, logout, PATCH profile? | Not enforced |
| 39 | Email verification for MVP? Needs an email provider | Not built; `is_email_verified` unused |
| 40 | Keep `POST /v1/account/auth/forgot-password` as a re-send alias, or drop it? | Not built (deferred) |
| 41 | Google sign-in: re-specify `POST /v1/account/auth/google` when started | Not built (deferred) |
| 42 | Meaning of `iotId`: container id in profile (§1.7), device id in claim (§2.1) | Profile returns `containers.id` |

Also open (§6 Q#1–34, §8 drift): seed resolve path (Q#26), `/v1/me/*` vs `/v1/experience/*` (Q#27), legacy unversioned `/auth/*` the app still calls (Q#28), endpoints the app calls with no contract entry (Q#29, e.g. `GET /v1/garden/home`), `/v1/notifications` prefix (Q#30), payments (Q#31), avatar (Q#32), mission data (Q#33). Do not add aliases to match the app. Ask.

## Admin (CMS) Contract: Conflicts, Not Decided

The BE docs win over the CMS spec until the spec is synced (spec-first rule). Differences found on 2026-11-02:

- **Admin login.** `api_contracts_cms.md` §1.2 takes `{ "firebaseIdToken" }`. `MINIMUM_STACK.md` §7 says admin uses email and password in `admin_users`, with a separate `ADMIN_JWT_SECRET` and `aud=admin`. The same path `POST /v1/admin/auth/login` is used in both.
- **Error envelope.** CMS §1.5 uses `{ "error": { code, message, details } }`. The BE uses `{ "status": { ... } }`.
- **Success shape.** CMS examples return bare objects or `{items, page, pageSize, total}`. The BE wraps everything in `data`.
- **Logout.** CMS returns `204`. The app logout returns `200 {isSuccess: true}`.
- **Roles.** CMS defines five roles. `ARCHITECTURE_DECISIONS.md` RBAC lists only `user` and `admin`.

The `cms-api-contract` and `cms-security-boundaries` skills currently follow the CMS spec. Flag this before building any admin endpoint.

Related: `golang-error-handling` for error wrapping and `golang-security` for input validation.
