---
name: cms-security-boundaries
description: Security rules for the GROWPICO CMS (Next.js admin dashboard) - session token handling in iron-session cookies, server-only Go calls, proxy.ts login redirect, cosmetic RBAC, Firebase config vs admin credentials, mock-mode guard, secrets, PII and open decisions.
---

# Skill: cms-security-boundaries

Load order: spec-first → cms-nextjs-architecture → **cms-security-boundaries** (with cms-api-contract for any call that needs the session).

## Purpose

The CMS is an internal tool with write access to users, devices and content. The Go Admin API is the only authority on permissions and rules. The CMS's job is to keep the admin session server-side, never leak it to the browser, redirect unauthenticated users, and hide controls the user cannot use. This skill lists the rules an agent must not break while vibe-coding the dashboard.

Sources: `garden-ai/solutioning/specs/domain/apps/CMS.md` (Auth, Architecture), `garden-ai/solutioning/specs/contracts/api_contracts_cms.md` (§1.2 auth and session, §1.3 RBAC, §1.4 reason and audit), `garden-ai/solutioning/specs/features/cms/admin_access_control.md` (§3 role matrix; self-protection rules), `garden-ai/solutioning/specs/features/cms/CMS_ASSESSMENT.md` (§18 open decisions).

## When to Use

- Login, logout, session cookie, `proxy.ts`, route guards, `requireRole`.
- Any new Server Action or route handler that mutates data.
- Any new component that shows or hides an admin action.
- Adding env vars, secrets, logging, or screens that show personal data.

## When Not to Use

- Flutter app auth or token storage: `security-boundaries` (Flutter skill).
- Admin role definitions and matrix content: that is spec work (`admin_access_control.md`).
- Layout or data-table work: `cms-ui-slicing`.

## Constraints

### 1. The session token lives only in the signed HTTP-only cookie

- The Go `sessionToken` (`POST /auth/login` response) is stored with **iron-session** in an HTTP-only cookie (CMS.md, contract §1.2).
- Cookie flags: `httpOnly: true`, `secure: true` in production, `sameSite: "lax"`, `path: "/"`, bounded `maxAge` aligned with `expiresAt` from the login response. (`sameSite` and cookie name are proposals; the spec only says signed HTTP-only.)
- The token never goes to: client JS, `localStorage`/`sessionStorage`, URL or query string, component props, RSC payloads, logs, error messages, or `console`.
- Pass the shell only the identity fields it needs: `{ id, email, displayName, role, permissions }`. Do not pass the session object to any client component.

```ts
// src/lib/auth/session.ts
import "server-only";
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";

export interface AdminSession { sessionToken: string; expiresAt: string; adminId: string; role: string }

const options: SessionOptions = {
  cookieName: "growpico_admin",                 // proposed name
  password: process.env.CMS_SESSION_SECRET!,    // >= 32 chars, Fly secret, never committed
  cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" },
};

export async function readSession() {
  return getIronSession<AdminSession>(await cookies(), options);   // cookies() is async in Next 16
}
```

### 2. All Go calls are server-side only

- Adapters (`src/lib/api/adapters/go/**`, `mock/**`), `lib/auth/**` and `lib/api/client.ts` start with `import "server-only";`. A client import then fails at build time.
- Call the API only from Server Components, Server Actions, and route handlers. The browser never receives `CMS_API_BASE_URL` in a `NEXT_PUBLIC_` variable.
- Do not add a `fetch` to the Go API inside a `"use client"` file, even for polling.

### 3. `proxy.ts` redirects unauthenticated users

- `src/proxy.ts` (Next 16 name; previously `middleware.ts`) checks for the presence of the session cookie and redirects to `/login` for every dashboard path. `/login` and static assets are excluded in `matcher`.
- The cookie check in `proxy.ts` is optimistic only. A forged or expired cookie passes it. The real check is in `app/(dashboard)/layout.tsx`: call `GET /auth/me` through the adapter, and redirect to `/login` on `401 unauthenticated` or `403 admin_inactive`.
- Never put business logic or data loading in `proxy.ts`.

### 4. Login and logout flow

1. The login page signs in with the Firebase Web SDK (Google or Email) on the client.
2. The client gets a Firebase ID token and passes it to a **Server Action** (not to the browser's API calls).
3. The action calls `POST /auth/login` with `{ firebaseIdToken }` through the adapter.
4. On `200`, it writes `{ sessionToken, expiresAt, adminId, role }` to the iron-session cookie and redirects to `/`.
5. Map errors to messages: `401 invalid_token`, `403 not_an_admin` (account not in `admin_users`), `403 admin_inactive`. Do not reveal which admins exist.
6. Logout: `POST /auth/logout` (204), then destroy the cookie, then redirect to `/login`.

Mock mode replaces steps 2–3 with a dev-only role picker (below).

### 5. RBAC in the UI is cosmetic; the API is the authority

- Contract §1.3: the API enforces with `403 forbidden_role`; the UI only hides buttons. Keep both: hide the control, **and** call `requireRole([...])` in every Server Action and in every route that loads role-restricted data.
- Visibility source: `GET /auth/me` returns `permissions` (domains the admin may access, derived from role, §1.2.2). Its exact shape is OPEN; until it is defined, derive visibility from `admin.role` with one table in `lib/nav.ts` that copies each endpoint's `Roles:` line from the contract.
- Role matrix in `admin_access_control.md` §3 is the human-readable reference. It conflicts with the contract on some rows (see OPEN). When they differ, the API section's `Roles:` line decides, and the difference is reported.
- On `403 forbidden_role` from a read, render `ForbiddenState`. On a mutation, show a toast with the mapped message and do not retry.
- Self-protection (admin_access_control §3): an admin cannot downgrade or deactivate themselves, and the last active `SUPER_ADMIN` cannot be deactivated. The API enforces this. The UI disables the control and shows the reason, but must still handle the API error.

### 6. Firebase: client config is public; admin credentials are not in the CMS

- **Firebase Web config** (`NEXT_PUBLIC_FIREBASE_*`) is public by design. It is not a secret and may be in the client bundle.
- **Firebase Admin credentials** (service account) are not required by the contract: the Go API receives the ID token and verifies it. CMS.md says "Firebase Admin verifies the internal account", which is ambiguous about where verification happens. OPEN: confirm the owner. Default in this skill: the CMS holds no Firebase Admin credentials. If one is ever needed, it is server-only, never `NEXT_PUBLIC_`, and stored as a Fly secret.

### 7. Mock mode is a development tool only

- `CMS_API_MODE=mock` enables fixtures and a role picker. The mock login is reachable only when `CMS_API_MODE === "mock"`; otherwise the route calls `notFound()`.
- `lib/api/client.ts` throws at startup when `NODE_ENV === "production"` and the mode is `mock`, unless an explicit demo flag exists (OPEN; not in the spec).
- The role picker is labeled "Dev only: mock role". Mock sessions use the same cookie, so a mock session cannot be used against the Go API (the Go API would reject the mock token).

### 8. Secrets and environment

- Secrets (`CMS_SESSION_SECRET`, any future service credentials) come from local `.env.local` (git-ignored) and Fly secrets in deploy. Never committed.
- `.env.example` has names and placeholder values only.
- Do not print env values in logs or error pages.

### 9. No direct database access

- The CMS has no database driver, ORM, connection string or migration tool. Reject any `pg`, `prisma`, `drizzle`, `@prisma/*`, or raw SQL dependency in `growpico-cms/`.
- All reads and writes go through the Go Admin API (CMS.md, Architecture). The Go side writes `audit_logs` in the same transaction as each mutation.

### 10. Server Actions and forms

- Next.js checks the Origin header on Server Action requests against the host. Keep the default. If the app sits behind a proxy with a different public host, configure allowed origins in `next.config` (verify the option name at scaffold time).
- Every action re-checks the session and role. The action ID is callable by anyone who can reach the server, so the UI hiding a button is never a security control.
- Validate all action input with Zod on the server, even if the client already validated it.
- Route handlers that mutate state (none expected in MVP) must check the Origin and session.

### 11. PII handling

- SUPPORT, OPERATIONS and SUPER_ADMIN see personal data (email, username, device links). Do not log emails, tokens or user IDs with names together. Log request ids and error codes only.
- The `search` filter on `GET /users` accepts email (contract §4.1). That puts email in the URL and in server access logs. Accept it as the contract requires; flag log scrubbing as an open item for ops.
- Chat transcripts: **default NO access** for SUPPORT (CMS_ASSESSMENT §18 #10). The contract defines no transcript endpoint. Do not add a route, tab or link.
- GDPR erasure (`DELETE /users/:id`, SUPER_ADMIN, §4.10) needs a confirm dialog, a ★ reason, and the anonymisation strategy is OPEN (§18 #4). Do not implement anonymisation logic in the CMS.

### 12. Re-authentication and destructive actions

- Spec gate today: ★ reason (5–500 chars) plus the audit entry. There is no spec for step-up re-auth. Do not invent one. Use ConfirmDialog for destructive actions and report the gap.

### 13. Security headers

- No spec defines CSP or other headers. Proposed baseline for `next.config`: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`. Mark as proposal until the devops owner confirms.

## Open decisions that affect the CMS (CMS_ASSESSMENT §18, §19)

| # | Decision | Impact on this skill / UI |
|---|---|---|
| 9 | Admin session model: server-side `admin_sessions` (recommended) vs stateless cookie | Logout and "revoke sessions" behavior differ. Build logout to call the API either way; do not assume the cookie alone revokes access. |
| 10 | SUPPORT access to chat transcripts (default no) | No transcript screen. Keep the default. |
| 6 | CONTENT_MANAGER activation rights for copy-only changes (recommended no) | Hide activate controls for CONTENT_MANAGER; the API decides. |
| 4 | GDPR erasure anonymisation for ledgers | Erasure UI blocked until decided. |
| 3 | Suspension effect on IoT ingestion | Show status only. |
| 5 | Emergency AI kill-switch in MVP | Not in MVP UI (Phase 2 endpoint #74). |
| 11 | Definition of active user (analytics) | Label analytics metrics with the API's own definition; do not compute "active" in the UI. |
| 12 | Manual AI quota reset for support | Not in MVP UI. |
| 13 | Backend contract detail restore | Affects mock fidelity only. |

§19 also lists the admin session model as an assumption (not decided). Treat it as OPEN.

## Open conflicts found while writing this skill

- **Learning question detail:** `admin_access_control.md` §3 gives READ_ONLY "view" on learning content, but contract §11.2 (detail with answer key) lists CONTENT_MANAGER only and §18 #59 agrees. The list (§11.1, `any`) and the detail are different. Treat the detail as CONTENT_MANAGER-only until the owner confirms.
- **Audit log roles:** contract §18 #68–70 gives SUPPORT (own) and OPERATIONS. The matrix also gives CONTENT_MANAGER "own actions" and SUPER_ADMIN "all". The contract does not list CONTENT_MANAGER. Follow the contract; flag the gap.
- **Admin roles list:** matrix gives roles administration only to SUPER_ADMIN; contract §18 #67 gives `GET /roles` to any role. Follow the contract for reads; flag.

## Conventions

- Put the role table in one file (`lib/nav.ts` or `lib/auth/roles.ts`); components import from it and never inline role strings.
- Never trust a role from the client. Read `admin.role` from the Go response (`/auth/me`), not from the cookie alone.
- For every new mutation: Zod input, `requireRole`, adapter call, `auditId` toast, `revalidatePath`. No exceptions.
- Log the request id (`X-Request-Id`) with errors so ops can match the audit entry.

## Checklist before handing back a security-sensitive change

- [ ] Session token appears only in `lib/auth/session.ts` and the adapter's `Authorization` header.
- [ ] `server-only` on every file that touches the session or Go API.
- [ ] Every new Server Action calls `requireRole` with the roles from the contract `Roles:` line.
- [ ] Hidden controls are backed by a server check (the UI is not the authority).
- [ ] No `NEXT_PUBLIC_` variable holds a secret.
- [ ] Mock login is unreachable when `CMS_API_MODE !== "mock"`.
- [ ] No database dependency added.
- [ ] No PII in logs or in the error boundary output.
