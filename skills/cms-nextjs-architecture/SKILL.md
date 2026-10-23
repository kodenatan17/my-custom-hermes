---
name: cms-nextjs-architecture
description: Scaffold, folder layout, Server/Client component rules, data flow, route-to-spec map and build order for the GROWPICO CMS (Next.js App Router admin dashboard in growpico-cms/).
---

# Skill: cms-nextjs-architecture

Load order: spec-first → **cms-nextjs-architecture** → (cms-ui-slicing | cms-api-contract | cms-security-boundaries) as relevant.

## Purpose

The GROWPICO CMS is the internal admin dashboard. It is a standalone Next.js App Router app in `growpico-cms/` (workspace root). It configures and operates the product; it never executes business rules and never touches the database. It talks only to the Go Admin API under `/v1/admin/*`. This skill fixes the stack, the scaffold, the folder layout, the rendering rules and the domain-to-route map, so an agent can scaffold and slice the CMS without asking basic questions.

Sources: `garden-ai/solutioning/specs/domain/apps/CMS.md` (Tech Stack, Architecture), `garden-ai/solutioning/specs/features/cms/CMS_ASSESSMENT.md` (§14 MVP scope, §17 implementation order, §18 open decisions), `garden-ai/solutioning/specs/contracts/api_contracts_cms.md` (§1 conventions, §18 endpoint index).

## When to Use

- Creating or changing anything under `growpico-cms/`.
- Deciding where a file, route, component or data call belongs.
- Mapping a CMS domain to its route, spec, contract section and roles.

## When Not to Use

- Flutter app work (`seedly_app/`): use `flutter-client-architecture`.
- Visual translation of a PNG: use `cms-ui-slicing` (this skill only defines where the result goes).
- Writing a new endpoint binding: use `cms-api-contract`.
- Auth, cookies, RBAC enforcement: use `cms-security-boundaries`.

## Stack (decided by the user; binding)

| Concern | Choice |
|---|---|
| Framework | Next.js, latest stable App Router (16+ at scaffold time). Pin exact versions when scaffolding; do not hardcode versions from memory. |
| Runtime | Node.js 20.9+ required by Next 16 for local dev and build. See OPEN item on the Docker image. |
| Language | TypeScript (strict) |
| Package manager | npm |
| Styling | Tailwind CSS v4 (CSS-first config via `@theme` in `globals.css`) |
| Components | shadcn/ui (Radix primitives) in `src/components/ui/` |
| Tables | TanStack Table (`@tanstack/react-table`) |
| Forms | React Hook Form + Zod (`@hookform/resolvers` for the Zod bridge) |
| Icons | lucide-react |
| Charts | Recharts, through the shadcn `chart` wrapper |
| Toasts | sonner (through shadcn `sonner`) |
| Dates | date-fns (all times displayed in UTC unless a spec says otherwise; contract ranges are UTC) |
| Session | iron-session (signed HTTP-only cookie) |
| JWT helpers | jose (only if a spec requires it; the contract does not) |
| Auth (identity) | Firebase client SDK for Google/Email sign-in; the Go API verifies the token |

## Scaffold (run once, in the empty `growpico-cms/` folder)

The folder exists and is empty. Run the commands from the workspace root. Confirm flags with `npx create-next-app@latest --help` at scaffold time.

```bash
cd /Users/snpmac003/ferry-dev/seedly/growpico-cms
npx create-next-app@latest . --ts --eslint --tailwind --src-dir --app --import-alias "@/*" --use-npm --yes

# runtime deps
npm i iron-session jose server-only zod react-hook-form @hookform/resolvers \
      @tanstack/react-table date-fns sonner lucide-react recharts

# shadcn (Tailwind v4 aware; writes components.json and globals.css tokens)
npx shadcn@latest init
npx shadcn@latest add button input label card table dialog sheet dropdown-menu \
      select badge tabs tooltip skeleton alert form separator avatar switch \
      textarea command popover calendar chart sonner

# dev deps (tests)
npm i -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom \
         @testing-library/user-event @testing-library/jest-dom
```

`next.config.ts` must contain:

```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = { output: "standalone" };
export default nextConfig;
```

Do not add `jose` or `iron-session` features beyond what `cms-security-boundaries` describes.

## Folder layout

```
growpico-cms/
├── design/                          # PNG exports from design; named <domain>-<screen>[-<state>].png
├── components.json                  # shadcn config (created by init)
├── next.config.ts                   # output: "standalone"
├── vitest.config.ts
├── src/
│   ├── proxy.ts                     # Next 16 request interception (was middleware.ts): unauth -> /login
│   ├── app/
│   │   ├── layout.tsx               # root: html, fonts, <Toaster />
│   │   ├── globals.css              # tailwind v4 import, shadcn tokens, @theme brand tokens
│   │   ├── (auth)/login/page.tsx    # sign-in (Firebase client) + mock role picker (mock mode only)
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx           # AppShell = sidebar + topbar; loads /auth/me; role-filters nav
│   │   │   ├── loading.tsx          # route-group fallback skeleton
│   │   │   ├── error.tsx            # route-group error boundary (client component)
│   │   │   ├── not-found.tsx
│   │   │   ├── page.tsx             # home / overview (OPEN: no spec defines it)
│   │   │   ├── users/page.tsx, users/[id]/page.tsx
│   │   │   ├── devices/...          # one folder per route in the table below
│   │   │   └── .../                 # same pattern for every domain
│   │   └── forbidden/page.tsx       # rendered when the API returns 403 forbidden_role
│   ├── features/<domain>/
│   │   ├── components/              # domain UI (client or server components)
│   │   ├── schemas/                 # Zod: query params, form inputs, reason input
│   │   ├── api/
│   │   │   ├── queries.ts           # server-only read helpers (called from Server Components)
│   │   │   └── actions.ts           # "use server" mutations (Server Actions)
│   │   └── types.ts                 # request/response types for this domain (from contract)
│   ├── lib/
│   │   ├── api/
│   │   │   ├── adapter.ts           # AdminApi interface (one namespace per domain)
│   │   │   ├── contract.ts          # Page<T>, AdminApiError, ApiErrorCode, AuditRef, Role
│   │   │   ├── client.ts            # adminApi(): picks adapter from CMS_API_MODE (server-only)
│   │   │   ├── errors.ts            # AdminApiError class + toActionError() mapper
│   │   │   └── adapters/
│   │   │       ├── mock/            # fixtures + seeded generator + role/permission simulation
│   │   │       └── go/              # fetch to CMS_API_BASE_URL with Bearer session token
│   │   ├── auth/
│   │   │   ├── session.ts           # iron-session read/write (server-only)
│   │   │   └── guard.ts             # requireSession(), requireRole([...]) (server-only)
│   │   ├── nav.ts                   # nav items: domain, href, allowed roles
│   │   └── format.ts                # date/number/enum label helpers
│   ├── components/
│   │   ├── ui/                      # shadcn primitives (generated; do not hand-edit)
│   │   └── shared/                  # CMS shared components (inventory in cms-ui-slicing)
│   └── test/                        # shared test setup and fixtures helpers
└── e2e/                             # Playwright smoke (optional, see Testing)
```

Rules:
- `components/ui/` is generated by shadcn. Customize through tokens and wrappers in `components/shared/`, not by editing primitives.
- A feature folder never imports from another feature folder. Shared pieces go to `components/shared/` or `lib/`.
- Only `app/` route files and `features/*/api/*` may call `adminApi()`. Components receive data as props.
- Anything that touches the session or the Go API starts with `import "server-only";`.

## Server vs Client Components

- **Default is a Server Component.** Pages, layouts, tables' data loading and detail views are server-rendered.
- Add `"use client"` only for: event handlers, `useState`/`useEffect`, TanStack Table's interactive state, RHF forms, dialogs/sheets/dropdowns opened by a user, toasts, charts (Recharts needs the client).
- Push `"use client"` to the leaf. A client component never imports `server-only` modules and never receives the session token as a prop.
- Props crossing the server → client boundary must be plain serializable data. Pass the minimum (e.g. `{ id, email, displayName, role, permissions }` for the shell, never the session object).

## Data fetching

- Reads happen in Server Components through `features/<domain>/api/queries.ts`, which calls `adminApi()`.
- Authenticated responses must not be cached across users. The Go adapter uses `cache: "no-store"`. Use React `cache()` only to dedupe calls within one request.
- Always `await` `params`, `searchParams`, `cookies()` and `headers()` (async in Next 16).
- Parse `searchParams` with Zod with defaults (`page=1`, `pageSize=20`); never trust raw strings.

```tsx
// src/app/(dashboard)/users/page.tsx
import { adminApi } from "@/lib/api/client";
import { usersListQuery } from "@/features/users/schemas/list-query";
import { UsersTable } from "@/features/users/components/users-table";

export default async function UsersPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = usersListQuery.parse(await searchParams);
  const page = await (await adminApi()).users.list(query);
  return <UsersTable data={page} query={query} />;
}
```

## Mutations

- All mutations are Server Actions in `features/<domain>/api/actions.ts` (`"use server"`).
- Each action: (1) validate input with the Zod schema on the server, (2) `requireRole([...])` for the roles in the contract, (3) call the adapter, (4) `revalidatePath` or `revalidateTag` for affected routes, (5) return `{ ok, auditId }` or `{ ok: false, code, fieldErrors }`.
- The client never calls `fetch` to the Go API directly.

```ts
// src/features/users/api/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { adminApi } from "@/lib/api/client";
import { requireRole } from "@/lib/auth/guard";
import { suspendUserInput } from "../schemas/user-actions";
import { toActionError } from "@/lib/api/errors";

export async function suspendUser(raw: unknown) {
  const input = suspendUserInput.safeParse(raw);
  if (!input.success) return { ok: false as const, fieldErrors: input.error.flatten().fieldErrors };
  await requireRole(["SUPPORT", "OPERATIONS", "SUPER_ADMIN"]); // contract §4.6 Roles
  try {
    const res = await (await adminApi()).users.suspend(input.data.id, input.data);
    revalidatePath(`/users/${input.data.id}`);
    revalidatePath("/users");
    return { ok: true as const, auditId: res.auditId };
  } catch (e) {
    return toActionError(e); // maps AdminApiError.code, e.g. reason_required, already_suspended
  }
}
```

## URL search params are the source of truth for lists

Filters, sort, `page` and `pageSize` live in the URL, so every list is shareable and survives refresh.

- The DataTable toolbar writes to the URL with `router.replace(`${pathname}?${params}`)` inside `useTransition`.
- Any filter change resets `page` to `1`.
- The server component re-runs with the new `searchParams` and fetches again.
- Pagination is offset-based (`page`, `pageSize`; max 100) to match the contract. Do not build cursor pagination for the CMS.

## Route files per route

Every route folder that loads data includes:
- `loading.tsx`: skeleton matching the final layout (no layout shift).
- `error.tsx`: client component, shows ErrorState with a retry button. Log the request id if present.
- `not-found.tsx` when a `[id]` is missing (the API returns `404 not_found`).
- A forbidden path: when the API returns `403 forbidden_role`, render `ForbiddenState` (see `cms-ui-slicing`), or redirect to `/forbidden`.

## Environment variables

| Name | Where | Purpose |
|---|---|---|
| `CMS_API_MODE` | server | `mock` or `go`. Default `mock` in dev only. Production build must refuse `mock` (see security skill). |
| `CMS_API_BASE_URL` | server | Go Admin API base, e.g. the contract base `https://api.seedly.io/v1/admin` (contract §1.1). Required when `go`. |
| `CMS_SESSION_SECRET` | server | iron-session password (proposed name; ≥ 32 chars). Never committed. |
| `CMS_MOCK_LATENCY_MS` | server | Optional artificial latency for mock mode (proposed name). |
| `CMS_MOCK_ROLE` | server | Optional default role for the mock login (proposed name, dev only). |
| `NEXT_PUBLIC_FIREBASE_*` | client | Firebase Web config (apiKey, authDomain, projectId, appId). Not secret by design. |

Put only non-secret values in `.env.example`. Real values go to local `.env.local` (git-ignored) and Fly secrets in deploy. Names marked "proposed" are not in the specs; confirm them with the owner.

## Scripts (package.json)

| Script | Command |
|---|---|
| `dev` | `next dev` |
| `build` | `next build` |
| `start` | `next start` (local check; Fly runs the standalone output) |
| `lint` | `eslint .` (Next 16 no longer ships `next lint`; confirm at scaffold) |
| `typecheck` | `tsc --noEmit` |
| `test` | `vitest run` |
| `test:watch` | `vitest` |
| `e2e` | `playwright test` (only when e2e exists) |

Definition of green before handing back: `typecheck`, `lint`, `test` and `build` pass.

## Testing

- **Unit / component (Vitest + Testing Library, jsdom):** every Zod schema in `features/*/schemas/` (valid, invalid, boundary cases such as reason length 4, 5, 500, 501), every StatusBadge enum mapping, DataTable URL-param logic, ReasonDialog submit gating.
- **Adapter contract tests:** run the same test suite against `mock` and `go` adapters (the go run uses a fake fetch). Both must return the shapes in `types.ts`.
- **E2E smoke (Playwright, optional):** login (mock mode), open each route once per role, verify nav visibility and one ★ mutation shows a ReasonDialog.
- Fixtures come from the mock adapter, not hand-written JSON per test.

## Domain → route → spec → contract map

Routes are proposed by this skill; the spec defines the domain, the contract defines the endpoints. Roles are copied from contract §18 (`Roles (min)`); when a per-section `Roles:` line in the contract differs, the section line wins. Build step is contract/assessment §17 (CMS follows the same order).

| # | Domain | Route(s) (proposed) | Spec (`specs/features/cms/`) | Contract § | Endpoints (§18 #) | Roles per §18 | Build step |
|---|---|---|---|---|---|---|---|
| 0 | Auth | `/login` (no dashboard route) | admin_access_control.md | §1.2 | 1–3 | login: none; me/logout: any | 2 |
| 1 | Admin access control | `/admin-users`, `/roles` | admin_access_control.md | §12 | 63–67 | list/create/update/revoke: SUPER_ADMIN; roles: any | 2 |
| 2 | Audit log | `/audit-logs`, `/audit-logs/[id]`, entity history from entity pages | audit_log.md | §13 | 68–70 | SUPPORT (own) / OPERATIONS (see OPEN) | 2 |
| 3 | User support & moderation | `/users`, `/users/[id]` (plant support view inside detail) | master_data_user.md | §4 | 12–23 | read: READ_ONLY+; suspend/reinstate/username/sessions: SUPPORT+; xp-correction/subscription/plant stage: OPERATIONS+; erasure: SUPER_ADMIN | 3 |
| 4 | Device registry | `/devices`, `/devices/[id]` | master_data_device.md | §5 | 24–28 | read: READ_ONLY; revoke/batch: OPERATIONS; release: SUPPORT | 3 |
| 5 | Species & seed kits | `/species`, `/species/[id]`, `/seed-kits` | master_data_seed_product.md | §2–3 | 4–11 | read: any; create/batch/disable: OPERATIONS; PATCH: CONTENT_MANAGER (name) / OPERATIONS; delete: OPERATIONS | 4 |
| 6 | Career missions | `/missions`, `/missions/[id]` | mission_management.md | §7 | 35–41 | read: any; create: CONTENT_MANAGER; publish/retire/delete: OPERATIONS | 5 |
| 7 | Challenges (legacy daily/weekly) | `/challenges` | mission_management.md | §8 | 42–45 | read: any; create: OPERATIONS; title: CONTENT_MANAGER; activate: OPERATIONS | 5 |
| 8 | Quests | `/quests` | mission_management.md | §9 | 46–49 | read: any; create: OPERATIONS; title: CONTENT_MANAGER; activate: OPERATIONS | 5 |
| 9 | Achievements, mastery, levels | `/achievements`, `/mastery-tiers`, `/levels` | achievement_management.md | §10 | 50–57 | read: any; create: OPERATIONS; copy: CONTENT_MANAGER; reward/threshold: OPERATIONS; level threshold: SUPER_ADMIN | 5 |
| 10 | Learning question bank | `/learning-questions`, `/learning-questions/[id]` | learning_content_management.md | §11 | 58–62 | list: any; detail/create/update: CONTENT_MANAGER; activate: OPERATIONS | 6 |
| 11 | Growth journey templates | `/growth-templates`, `/growth-templates/[id]` | master_data_growth_journey.md | §6 | 29–34 | read: any; create: CONTENT_MANAGER; update: CONTENT_MANAGER (copy) / OPERATIONS; activate/delete: OPERATIONS | 7 |
| 12 | IoT monitoring (read-only) | `/iot`, `/iot/devices/[id]` | iot_monitoring.md | §15 | 76–79 | READ_ONLY | 8 |
| 13 | AI usage / quota (read-only) | `/ai` | ai_management.md | §14 | 71–73 | usage: READ_ONLY; quota: SUPPORT; config view: OPERATIONS | 8 |
| 14 | Analytics (table-backed) | `/analytics` | analytics.md | §16 | 81–85 | any | 8 |

Not in the MVP table (do not build; see `cms-api-contract`):
- Phase 2: #74 `PATCH /ai/config`, #75 `/ai/review-queue…`, #80 `PATCH /iot/devices/:id/config`, and §14.4, §14.5, §15.5 of the contract.
- Deferred (no entity): content/announcements `/v1/admin/content`, notification templates, plans/payments, assessments (contract §17).

Build order (CMS_ASSESSMENT §17, applied to the frontend):
1. Scaffold, AppShell, role-filtered nav, mock login, `requireRole`, ForbiddenState.
2. Admin access control (§12) and audit log (§13), plus the ReasonDialog and auditId toast. Every later step reuses these.
3. Users (§4) and devices (§5) for beta support.
4. Species, care profile, seed kits (§2–3).
5. Missions, challenges, quests (§7–9), then achievements, mastery, levels (§10).
6. Learning questions (§11).
7. Growth journey templates (§6).
8. IoT (§15), AI usage (§14), analytics (§16).
9. Phase 2 items, only when asked.

## Conventions

- Mirror the spec's Indonesian enum and field names in code as they appear in the contract (camelCase fields, SNAKE_CASE enums). Do not translate them.
- One domain = one `features/<domain>/` folder. Shared admin shell pieces live in `components/shared/`.
- Keep UI strings for a feature in one file (`features/<domain>/copy.ts`) so the UI copy language can be decided later (see OPEN).
- Prefer `unknown` plus Zod parsing at every boundary over casts.

## OPEN

- Node version conflict: Next 16 needs Node ≥ 20.9, while `garden-ai/solutioning/infrastructure/DEPLOYMENT.md` builds the CMS image from `node:18-alpine` (both builder and runtime stages). Do not edit DEPLOYMENT.md here; decide the image Node version with the devops owner before the first Fly deploy.
- Home/overview dashboard (`/`): no spec defines its content.
- Dashboard route for plant support (`GET /plants/:id`, `PATCH /plants/:id/stage`): placement inside `/users/[id]` is a proposal.
- Challenge naming (CMS_ASSESSMENT §18 #2): the CMS uses `/challenges` per the contract; the app path is still open.
- Route names above are proposals; the contract defines paths only for the API.
