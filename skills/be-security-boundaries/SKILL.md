---
name: be-security-boundaries
description: "growpico-be security: argon2id, HS256 JWT, refresh rotation, rate limits, secrets, PII in logs, planned admin/RBAC."
---

# Skill: be-security-boundaries

Load order: spec-first → be-architecture → **be-security-boundaries** (with be-api-contract for any new route). The CMS side is `cms-security-boundaries`; the Flutter side is `security-boundaries`. Go security checklist and threat model: golang-security. Error and log hygiene: golang-error-handling.

## Purpose

The backend is the only authority for accounts, sessions and (later) admin access. This skill lists what the code enforces today, what is only specified, and what must not be built without a decision.

## When to Use

- Login, register, refresh, logout, `Authenticate`, rate limits, config and secrets.
- Any new route that needs a session, a role or a data-ownership check.
- Logging, error messages, anything that could carry PII.

## When Not to Use

- Flutter token storage: `security-boundaries`. CMS session cookie: `cms-security-boundaries`.
- Column-level schema questions: `be-database`.

## Implemented Controls (verified in code, 2026-11-02)

### Passwords (`internal/auth/password.go`)

- argon2id, time 2, memory 19 MiB (`m=19456`), 1 lane, 32-byte key, 16-byte random salt, PHC-style encoding `$argon2id$v=19$m=…,t=…,p=…$salt$key`.
- Parsing bounds: memory ≤ 256 MiB, time ≤ 10, so a tampered row cannot force huge allocations. A malformed hash fails closed.
- At most 4 hashes run at once (`hashSlots`), to protect the small instance.
- Length 8–128 characters. No composition rules.
- Unknown email still runs one verification against a dummy hash (`dummyHash`), so timing does not reveal account existence.

### Login and registration (`auth/service.go`, `auth/handler.go`)

- Email: trimmed, lowercased, at most 254 characters, must parse with `net/mail` and have a dot in the domain.
- Unknown email and wrong password return the same `401 invalid_credentials`. The integration test checks this.
- Rate limits run before the credential check (see table below).
- Suspended accounts get `403 account_suspended` only after the password matches.

### Access tokens (`auth/tokens.go`, `auth/middleware.go`)

- HS256 only (`WithValidMethods`). Checks issuer `growpico`, audience `app`, required `exp`, 5 s leeway.
- Claims: `sub` (user id), `sid` (session id), 15 min by default. No role, tier or status in the token.
- `JWT_SECRET` must be at least 32 bytes (checked by length in `config.Load`, not entropy). No `kid`; rotation is planned.
- **Every Bearer request** re-reads the session (not revoked, not expired) and the owner's status (`SUSPENDED` with no expired window, or `DELETED`). A revoked session stops working at once.

### Refresh tokens (`auth/tokens.go`, `auth/service.go`, `auth/store.go`)

- Opaque: `rf_` + 32 random bytes, base64url. Only the SHA-256 hex digest is stored (`sessions.refresh_token_hash`, unique). Lifetime 30 days.
- Rotation runs in one transaction. The old row is locked with `FOR UPDATE`, revoked, and a new session is inserted with `rotated_from_id`.
- **Reuse.** If the presented token is revoked and a rotated child exists, every session of that user is revoked. The response is still `401 invalid_refresh_token`.
- Observed: a token revoked by logout has no rotated child, so presenting it again returns `401` without revoking other sessions. This matches the spec's wording ("reuse of a rotated token"), but state it if asked.
- A suspended owner gets `403` on refresh and nothing is rotated.

### Logout

- Revokes the current session (`sid`). The access token stops working immediately, not at its 15 min expiry.

### Rate limits (`httpx/ratelimit.go`, `auth/handler.go`)

| Route | Limit | Key | Order |
|---|---|---|---|
| login | 60 / 15 min | client IP | first |
| login | 10 / 15 min | normalised email | second |
| register | 20 / hour | client IP | only key |
| refresh | 120 / 15 min | client IP | only key |

- In memory, per process, sliding window. Resets on restart. Correct only for one instance (Render free).
- Client IP is the first valid `X-Forwarded-For` entry. It can be spoofed, so the per-email login limit is the real control. **Register has only the IP limit.** Spoofing `X-Forwarded-For` bypasses it. Flag this before public launch.
- Not built: app 120/min/user, device 1 per 5 s.

### Transport, headers and limits (`httpx/middleware.go`, `cmd/api/main.go`)

- Set by the app: `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.
- Not set by the app: HSTS, CSP, `X-Frame-Options`, CORS (not built). `ARCHITECTURE_DECISIONS.md` lists HSTS as a requirement; check the Render edge before claiming it.
- Request body max 1 MiB. Header max 64 KiB. Read-header 10 s, read 20 s, write 30 s, idle 60 s.
- Panics return `500 internal_error` and are logged with the stack.

### Secrets and configuration

- Secrets come from environment variables only: `DATABASE_URL` and `JWT_SECRET` (Render dashboard in deploy).
- `.gitignore` covers `.env` and `/bin/`. `.env.example` holds placeholders only. `JWT_SECRET=` is empty in the example.
- Config errors name the variable. Only non-secret values are echoed (`ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `DB_MAX_CONNS`). `DATABASE_URL` and `JWT_SECRET` are never echoed.
- `server_integration_test.go` uses a fixed test secret (`…-test`). It is test-only. Never reuse it outside tests.
- Do not print `DATABASE_URL` or `JWT_SECRET` in logs, errors, README examples or chat.

### Logging and PII

- Access log fields: `request_id`, `method`, `path`, `status`, `duration_ms`. Headers and bodies are never logged.
- Path carries no user input today. Keep it that way: no emails or usernames in URL paths.
- 5xx errors are logged with the raw error chain (`error` attribute). Keep user input and emails out of error strings. The current code does (`normalizeEmail` and the validators return fixed messages).
- PII in the schema (verified in `db/migrations/20261005_01_initial_schema.sql`): `users.email`, `users.username`, `user_identities.email`, `admin_users.email`; `sessions.ip` and `sessions.user_agent` (written at every login, register and refresh); `admin_sessions.ip` and `admin_sessions.user_agent`; `audit_logs.ip` and `audit_logs.actor_email`; and user free text that may contain anything: `chat_messages.content`, `ai_memories.content`, `care_actions.note`. Do not log these values, do not return them to anyone but their owner (or an authorised admin), and never put them in error strings. The profile returns `email` to its owner only.

## Specified, Not Built (do not build without a decision)

| Area | Spec | Status | Open item |
|---|---|---|---|
| Admin login and sessions | `MINIMUM_STACK.md` §7: email and password in `admin_users`, `POST /v1/admin/auth/login`, separate `ADMIN_JWT_SECRET`, `aud=admin`, `admin_sessions` | No admin module | The CMS contract §1.2 says Firebase ID token instead. BE docs win until the spec is synced (spec-first rule). Ask the owner. |
| Admin roles | CMS contract: `SUPER_ADMIN`, `OPERATIONS`, `CONTENT_MANAGER`, `SUPPORT`, `READ_ONLY` | No code | `ARCHITECTURE_DECISIONS.md` RBAC lists only `user` and `admin`. Reconcile first. |
| Audit log | `audit_logs` for claim/unclaim, token rotation, admin actions, XP and score overrides (`ARCHITECTURE_DECISIONS.md`) | Table exists; no writer | Token-rotation audit is specified but not written today. |
| Device auth | Bearer token (hashed in `devices.device_token_hash`) + HMAC-SHA256 `X-Signature`; secrets from factory CLI only | No devices code | Not built. |
| Account deletion, GDPR erasure | Delete user and anonymise device (`ARCHITECTURE_DECISIONS.md` Compliance) | No endpoint | App still calls legacy `/auth/delete-account` (contract Q#28). |
| Email verification | `is_email_verified` column | Unused | Needs an email provider (Q#39). |
| Forgot password | Deferred (`MINIMUM_STACK` M2) | Not built | Users cannot reset passwords. Manual/admin reset has no tooling yet. Q#40. |
| Google sign-in | `identity` type `GOOGLE` in schema | Not built | Q#41. |
| Age gate 13+ | `users.age_gate_confirmed_at` | Never set | Q#37. |
| Key rotation | `kid` header, two keys accepted | Not built | Planned. |

## Forbidden Patterns

- Storing refresh tokens in plain text, or as a JWT (they must be revocable).
- Putting role, tier or account status in the access token. Read them per request.
- Accepting a Firebase token. Contract §0.2 forbids it.
- Trusting a user id from the body or path. Use `auth.PrincipalFrom`.
- Comparing secrets or hashes with `==`. Use `crypto/subtle` (the current code does).
- Building a `/v1/admin/*` route on the user token, or accepting an admin token on `/v1/*`.
- Adding an endpoint that changes XP, scores or photo validity without the ledger rule (contract §0 and `ARCHITECTURE_DECISIONS.md` invariant 3).
- Using `math/rand` for any token or id.

## Checklist Before Handing Back a Security-Sensitive Change

- [ ] New Bearer route uses `authenticate(httpx.Handle(...))` and takes the user id from `PrincipalFrom`.
- [ ] No token, hash, password, secret or email in logs, errors or responses (other than the owner's own profile).
- [ ] Error messages are fixed strings. Unknown-account and wrong-password paths still look identical.
- [ ] New input has a size limit (1 MiB body cap applies) and a length or format check in the service.
- [ ] Rate limit added for any new unauthenticated or credential-checking route.
- [ ] Migrations keep the constraints the code relies on (`be-database`).
- [ ] `go test -race ./...` with `TEST_DATABASE_URL` set (be-architecture §Verification).
- [ ] Open items in the table above are reported, not silently decided.

## Pairing

- CMS: `cms-security-boundaries` describes an iron-session cookie and a Firebase login. That is the CMS spec's version, which conflicts with the BE docs above. Until resolved, the CMS skill is out of date on login.
- App: `security-boundaries` (token storage, re-auth, upload validation).
- Go hygiene: golang-security (SQL, crypto, PII) and golang-error-handling (single handling rule, no internals to clients).
