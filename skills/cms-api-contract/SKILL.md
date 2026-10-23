---
name: cms-api-contract
description: How the GROWPICO CMS calls the Go Admin API (/v1/admin/*) - conventions, error envelope, reason and auditId, turning a contract section into types, Zod schemas, adapter methods and mock fixtures, and the mock/go adapter switch.
---

# Skill: cms-api-contract

Load order: spec-first → cms-nextjs-architecture → **cms-api-contract** (plus cms-security-boundaries for any auth or session work).

## Purpose

The CMS consumes only the Go Admin API under `/v1/admin/*`, specified in `garden-ai/solutioning/specs/contracts/api_contracts_cms.md`. The Go implementation (`internal/modules/admin`) does not exist yet (contract §Status). During slicing, the CMS talks to a **mock adapter** built from the contract. The UI must not change when the **go adapter** is switched on. This skill defines the conventions, the adapter boundary, and the procedure to turn a contract section into code.

## When to Use

- Any read or mutation the CMS makes to the Admin API.
- Writing `types.ts`, Zod schemas, adapter methods, mock fixtures or error mapping for a domain.
- Deciding whether an endpoint is in MVP, Phase 2 or deferred.

## When Not to Use

- App-facing `/v1/*` endpoints: those belong to `api-contract-conventions` (Flutter app). The CMS never calls them.
- Layout or component work: `cms-ui-slicing`.
- Session cookie, token storage, RBAC enforcement: `cms-security-boundaries`.

## Constraints

- **Only `/v1/admin/*`.** Never call Firebase Admin, the database, the device API (`/v1/iot/*`) or the app API (`/v1/*`) from the CMS.
- **Server-side only.** All adapter calls run in Server Components, Server Actions or route handlers. The browser never sees the Go base URL or the session token.
- **No business rules in the CMS.** The CMS configures and operates; the backend executes. No CMS code computes XP, levels, mission progress, achievement unlocks, photo validity, or telemetry corrections. Display what the API returns.
- **No invented fields.** If a screen needs a field the contract does not define, flag it as OPEN in the skill or the report. Do not guess the shape.
- **Phase 2 and deferred paths are not built** unless the user asks (see §Scope below).

## Contract conventions (§1, copied)

| Topic | Rule (contract §1) |
|---|---|
| Base URL | `https://api.seedly.io/v1/admin` (set via `CMS_API_BASE_URL`) |
| Casing | JSON `camelCase`, path `kebab-case`, enums `SNAKE_CASE` |
| Auth header | `Authorization: Bearer <adminSessionToken>` on every endpoint except `POST /auth/login` (§1.2) |
| Request id | optional `X-Request-Id: <uuid>`; the Go side copies it to `audit_logs.request_id`. The go adapter sends one per request. |
| Pagination | offset: `?page=1&pageSize=20`, max `pageSize=100`. List response is always `{ items, page, pageSize, total }`. |
| Time range | `?range=7d`, `30d` or `90d` (UTC) on metric endpoints |
| Rate limit | admin tier, recommended 300 req/min/session (§1.1). The UI should not fire bursts of requests (debounce search). |
| Roles | `SUPER_ADMIN`, `OPERATIONS`, `CONTENT_MANAGER`, `SUPPORT`, `READ_ONLY`. The API enforces with `403 forbidden_role`; the UI only hides controls (§1.3). |

### Login and session endpoints (§1.2)

- `POST /auth/login` body `{ firebaseIdToken }` → `200 { sessionToken, expiresAt, admin: { id, email, displayName, role } }`. Errors: `401 invalid_token`, `403 not_an_admin`, `403 admin_inactive`.
- `GET /auth/me` → `admin` object plus `permissions` ("daftar domain yang boleh diakses, diturunkan dari role"). The exact `permissions` shape is not specified: OPEN.
- `POST /auth/logout` → `204 No Content`.

## Error envelope (§1.5)

Every error body has this shape. Parse it once, in `go` adapter's `request()` helper. Do not special-case per endpoint.

```json
{ "error": { "code": "invalid_payload", "message": "Human readable error description", "details": { "field": "reason" } } }
```

Codes listed in §1.5: `401 unauthenticated`, `403 forbidden_role`, `404 not_found`, `409 conflict`, `422 invalid_payload`, `422 reason_required`. Endpoint-specific codes appear in each section's `Error Codes` line (examples: `401 invalid_token`, `403 not_an_admin`, `403 admin_inactive`, `409 already_suspended`, `409 no_active_journey_template`, `422 amount_zero`, `422 xp_below_zero`).

```ts
// src/lib/api/errors.ts
export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,            // e.g. "forbidden_role", "reason_required"
    message: string,
    readonly details?: Record<string, unknown>,
  ) { super(message); }
}
```

UI rule: map `code` to a human message in `copy.ts`; never render raw codes.

## Reason and audit (§1.4) - the ★ rule

- Every mutation marked **★** in the contract requires `reason` (string, **5–500 characters**). Missing or empty → `422 reason_required`.
- Every mutation (★ or not) returns `auditId`. The toast shows it and links to `/audit-logs/[auditId]` (contract §13.2).
- Entity history: `GET /audit-logs/entity/:entityType/:entityId` (§13.3) backs the "History" tab on detail pages.

```ts
// src/lib/api/contract.ts
import { z } from "zod";

export const reasonSchema = z
  .string()
  .trim() // UI choice; confirm with API owner (see OPEN)
  .min(5, "Reason must be at least 5 characters")
  .max(500, "Reason must be at most 500 characters");

export interface Page<T> { items: T[]; page: number; pageSize: number; total: number; }
export interface AuditRef { auditId: string; }
export type Role = "SUPER_ADMIN" | "OPERATIONS" | "CONTENT_MANAGER" | "SUPPORT" | "READ_ONLY";
```

Mutation input convention: `{ reason: string, ...fields }` for ★ endpoints. Non-★ mutations send only their fields.

## Procedure: contract section → code

Do these steps in order for one endpoint or one section. Never skip step 1.

1. **Read the section** in `api_contracts_cms.md` (Method/Path, Roles, Query, Request, Response, Error Codes, Deskripsi). Read the `Roles:` line; it wins over the §18 index when they differ.
2. **`features/<domain>/types.ts`** - copy the response example into TS types. Use the contract's exact field names. Enums as string-literal unions copied from the contract.
3. **`features/<domain>/schemas/`** - Zod for query strings (`page`, `pageSize` default 1/20, max 100), form inputs, and the ★ input (`reasonSchema.extend({...})`).
4. **`lib/api/adapter.ts`** - add the method to the domain namespace of `AdminApi`. Return types come from step 2.
5. **`lib/api/adapters/go/`** - implement the HTTP call (path, method, query, body). No logic beyond transport and error mapping.
6. **`lib/api/adapters/mock/`** - implement the same method with a fixture and simulated rules (below).
7. **Tests** - one schema test, one adapter parity test (mock and go return the same shape).
8. **Only then** build the UI (`cms-ui-slicing`).

```ts
// src/lib/api/adapter.ts (excerpt)
import type { Page, AuditRef, Role } from "./contract";
import type { UserListItem, UserListQuery, SuspendUserInput, UserDetail } from "@/features/users/types";

export interface AdminApi {
  auth: {
    login(firebaseIdToken: string): Promise<{ sessionToken: string; expiresAt: string; admin: AdminMe }>;
    me(): Promise<AdminMe>;
    logout(): Promise<void>;
  };
  users: {
    list(q: UserListQuery): Promise<Page<UserListItem>>;   // §4.1
    get(id: string): Promise<UserDetail>;                  // §4.2
    suspend(id: string, input: SuspendUserInput): Promise<AuditRef & { id: string; status: "SUSPENDED"; suspendedUntil: string | null }>; // §4.6
    // ...one entry per contract section; extend, do not bypass
  };
  // devices, species, seedKits, growthTemplates, missions, challenges, quests,
  // achievements, masteryTiers, levels, learningQuestions, adminUsers, roles,
  // auditLogs, ai, iot, analytics
}

export interface AdminMe { id: string; email: string; displayName: string; role: Role; permissions: unknown } // permissions shape OPEN
```

```ts
// Example: §4.6 Suspend Account (★)
// features/users/types.ts
export interface SuspendUserInput { id: string; reason: string; durationDays?: number } // durationDays bounds OPEN

// features/users/schemas/user-actions.ts
import { z } from "zod";
import { reasonSchema } from "@/lib/api/contract";
export const suspendUserInput = z.object({
  id: z.string().uuid(),
  reason: reasonSchema,
  durationDays: z.number().int().optional(), // contract: optional, omitted = until reinstated; bounds OPEN
});
```

### Go adapter (transport only)

```ts
// src/lib/api/adapters/go/request.ts
import "server-only";
import { randomUUID } from "node:crypto";
import { AdminApiError } from "../../errors";

export async function request<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  opts: { token: string; query?: Record<string, unknown>; body?: unknown },
): Promise<T> {
  const url = new URL(process.env.CMS_API_BASE_URL! + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v != null) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      "X-Request-Id": randomUUID(),
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error ?? { code: "unknown", message: res.statusText };
    throw new AdminApiError(res.status, e.code, e.message, e.details);
  }
  return json as T;
}
```

## Mock adapter rules

The mock is what the UI runs against until the Go API exists. It must behave like the contract, not like a happy-path stub.

- **Deterministic fixtures.** Seeded PRNG (fixed seed constant, e.g. mulberry32) and a fixed "now" anchor (e.g. `2026-08-01T00:00:00Z`, the date family used in the contract examples). IDs are UUIDs derived from the seed. Snapshots must be stable across runs.
- **Realistic enums** copied from the contract (`UserStatus`, `SUSPENDED`, etc.). When the contract gives no enum list, mark the field OPEN and use a single placeholder value.
- **Pagination, filter, sort are simulated server-side:** `page`, `pageSize` (clamp to 100), `total`, and the documented filter params (e.g. §4.1 `search`, `status`, `createdFrom`, `createdTo`).
- **Role simulation:** a table `endpointRoles` built from each section's `Roles:` line. Any call with a role not in the list returns `403 forbidden_role` with the standard envelope. The mock login picks the role (dev only; see security skill).
- **★ rule:** a ★ mutation without `reason` returns `422 reason_required`. Reason length 1–4 or 501+ returns `422 invalid_payload` with `details: { field: "reason" }` (the contract does not name the code for length errors; OPEN).
- **Every mutation returns `auditId`** (a UUID). Store an entry in an in-memory audit list so `/audit-logs` shows it after a mutation.
- **Documented errors:** e.g. `409 already_suspended` when suspending a suspended user; `409 conflict` for stale state where the section implies it.
- **Latency toggle:** `CMS_MOCK_LATENCY_MS` (proposed) delays every call so loading and skeleton states can be checked.
- **Persistence:** mutations update a `globalThis` store so the UI reflects changes within one dev session. HMR resets are acceptable.
- **Never** return fixtures that include real emails or PII. Use `@example.com`.

```ts
// src/lib/api/adapters/mock/users.ts (shape)
export function mockUsers(store: MockStore, role: Role): AdminApi["users"] {
  return {
    list: async (q) => {
      assertRole(role, "GET /users");                         // throws 403 forbidden_role
      const rows = applyFilters(store.users, q);              // search/status/tier/date
      return paginate(rows, q.page, q.pageSize);              // { items, page, pageSize, total }
    },
    suspend: async (id, input) => {
      assertRole(role, "POST /users/:id/suspend");
      requireReason(input.reason);                            // 422 reason_required
      const u = store.users.get(id);
      if (u.status === "SUSPENDED") throw new AdminApiError(409, "already_suspended", "Already suspended");
      u.status = "SUSPENDED";
      return { id, status: "SUSPENDED", suspendedUntil: null, auditId: store.audit(role, "users.suspend", id, input.reason) };
    },
    // ...
  };
}
```

## Scope

| Bucket | Endpoints (contract §18 index numbers) | Action |
|---|---|---|
| MVP | #1–73, #76–79, #81–85 | Build in order (see `cms-nextjs-architecture`). |
| Phase 2 | #74 `PATCH /ai/config`, #75 `GET/POST /ai/review-queue…`, #80 `PATCH /iot/devices/:id/config`; contract §14.4, §14.5, §15.5 | Do not slice or mock unless asked. Reserve the route folder only if the user asks. |
| Deferred (no entity) | `/v1/admin/content`, `/v1/admin/notifications/templates`, `/v1/admin/plans`, `/v1/admin/payments`, `/v1/admin/assessments` (contract §17) | Do not build. |

Notes:
- `DELETE /users/:id` (#21, SUPER_ADMIN) is in MVP per the index, but CMS_ASSESSMENT §14 lists user support as suspend/reinstate/tier/XP/session revoke and GDPR erasure is an open anonymisation question (§18 #4). Build the button only with a confirm dialog and the open question flagged.
- `POST /devices/batch` (#26, OPERATIONS) is in the MVP index, but CMS_ASSESSMENT §14 removes "device factory batch registration via CMS" and §18 #1 keeps it open. Flag before building.

## Phase rule for numbers

The contract says "MVP = 79 endpoint". Counting the §18 index rows gives 82 MVP rows (#1–73, #76–79, #81–85). Some rows bundle two paths (`/disable` · `/enable`, `/activate` · `/deactivate`). The count does not reconcile; treat the index rows as the build list and flag the mismatch.

## Business rules the CMS must not implement

Copied from the contract principle ("CMS mengonfigurasi, backend mengeksekusi"):
- No endpoint in the CMS grants XP, MP, or achievements directly, marks mission progress, validates photos, or changes telemetry.
- XP correction (§4.5, OPERATIONS, ★) is a ledger correction the backend performs. The CMS sends the request and displays the returned ledger state. It never computes the new XP balance locally.
- Level thresholds, mastery thresholds and reward values are stored by the backend. The CMS edits them through the contract and shows the server's response.
- Suspension effects on IoT ingestion are an open decision (§18 #3). The CMS shows the status only.

## Conventions

- Keep the adapter interface the single boundary: UI and actions never import `adapters/go` or `adapters/mock` directly, only `adminApi()`.
- Parity tests run on both adapters for every method added.
- Copy error code strings exactly from the contract; add new ones to the errors list only when a section documents them.
- Use the contract's Indonesian section names in code comments only as a reference (`// §4.6`), not as identifiers.

## OPEN

- `subscriptionTier` enum values are only shown as `FREE` in the example (§4.1, §4.8). Full list OPEN.
- `GET /auth/me` `permissions` shape is not defined (§1.2.2).
- `durationDays` bounds for suspend are not defined (§4.6).
- Reason length error code (1–4 or 501+ characters) is not defined. Only "empty" maps to `reason_required`. Confirm whether the UI should trim before counting (§1.4).
- `api_contracts_backend.md` no longer carries error-code detail or the photo validation section (CMS_ASSESSMENT §18 #13). Admin endpoints do not depend on it, but any cross-reference from the CMS contract to app endpoints is unverified.
- Backend Go module does not exist yet; mock fidelity is the only check until then.
