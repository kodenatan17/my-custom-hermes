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
| Components | shadcn/ui (Radix primitives) in `src/shared/ui/` — deferred until a second domain needs shared UI |
| Tables | TanStack Table (`@tanstack/react-table`) |
| Forms | React Hook Form + Zod (`@hookform/resolvers` for the Zod bridge) |
| Icons | lucide-react |
| Charts | Recharts, through the shadcn `chart` wrapper |
| Toasts | sonner (through shadcn `sonner`) |
| Dates | date-fns (all times displayed in UTC unless a spec says otherwise; contract ranges are UTC) |
| Session | iron-session (signed HTTP-only cookie) |
| JWT helpers | jose (only if a spec requires it; the contract does not) |
| Auth (identity) | Firebase client SDK for Google/Email sign-in; the Go API verifies the token |

## Scaffold (already done — do not re-run)

The app is scaffolded (Next 16, TS strict, Tailwind v4, `src/`, `@/*` alias). The block below is the historical scaffold, kept as reference: install only the dependencies a new domain actually needs, and pin versions from `npm view` at that time — never from memory.

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
├── next.config.ts                   # output: "standalone"
├── vitest.config.ts
├── scripts/                         # boundaries.mjs (R1–R6), client-boundary.mjs, smoke.mjs
├── src/
│   ├── proxy.ts                     # Next 16 request interception (was middleware.ts): unauth -> /login (optimistic only)
│   ├── app/                         # routing only: pages, layouts, loading/error/not-found
│   │   ├── layout.tsx, globals.css, not-found.tsx
│   │   ├── (auth)/login/page.tsx    # sign-in + mock credential picker (mock mode only)
│   │   ├── (dashboard)/layout.tsx   # shell: header + nav, identity via requireSession()
│   │   ├── (dashboard)/page.tsx     # home / overview (OPEN: no spec defines it)
│   │   ├── (dashboard)/<domain>/... # one folder per route in the map below
│   │   └── forbidden/page.tsx       # 403 forbidden_role / role mismatch
│   ├── features/<domain>/
│   │   ├── domain/                  # entities/ + repositories/ (ports): pure, no framework
│   │   ├── application/usecases/    # use cases orchestrating the ports
│   │   ├── infrastructure/          # datasources/ + mappers/ + repositories/ (adapters)
│   │   ├── presentation/            # actions/ ("use server") + components/
│   │   ├── di/container.server.ts   # the single wiring point (server-only)
│   │   ├── server.ts                # server-side public surface ("server-only")
│   │   └── index.ts                 # client-safe surface: types + constants only
│   └── shared/
│       ├── config/config.ts         # env parsing + mode gates (server-only)
│       ├── lib/api/                 # gateway.ts (sole backend gate), errors.ts
│       ├── lib/auth/                # session.ts (iron-session), guard.ts (requireSession/requireRole)
│       └── types/                   # cross-domain contract types (Role, AdminIdentity, AdminApi)
└── e2e/                             # Playwright smoke (optional, see Testing)
```

Rules:
- **Only `features/<domain>/server.ts`, `features/<domain>/di/**` and `shared/lib/api/gateway.ts` may call the gateway** (`adminApi()`); everything else receives data as props or through a use case. Enforced by `scripts/boundaries.mjs` R1–R6 — do not work around a lint error, fix the layering.
- A feature never imports another feature; shared pieces go to `shared/` (or `features/<d>/domain` ports, type-only).
- Layers point inward (`presentation → application → domain`, `infrastructure → domain`); no layer imports its own `server.ts`/`index.ts`.
- `app/` is routing only: no business logic, no adapter construction; pages/layouts read through `features/<d>/server.ts`.
- Auth kernel (guard, session, contracts) stays in `shared/` — not `features/auth` — because every domain needs it and features may not import each other.
- Anything that touches the session or the Go API starts with `import "server-only";`.
- Create `src/shared/ui/`, `src/providers/`, business `features/<d>/` and `app/api/**` only when a second consumer actually needs them.

## Server vs Client Components

- **Default is a Server Component.** Pages, layouts, tables' data loading and detail views are server-rendered.
- Add `"use client"` only for: event handlers, `useState`/`useEffect`, TanStack Table's interactive state, RHF forms, dialogs/sheets/dropdowns opened by a user, toasts, charts (Recharts needs the client).
- Push `"use client"` to the leaf. A client component never imports `server-only` modules and never receives the session token as a prop.
- Props crossing the server → client boundary must be plain serializable data. Pass the minimum (e.g. `{ id, email, displayName, role, permissions }` for the shell, never the session object).

## Data fetching

- Reads happen in Server Components through `features/<domain>/server.ts` (use case → gateway). A page never imports a layer folder or the adapter.
- Authenticated responses must not be cached across users. The Go adapter uses `cache: "no-store"`. Use React `cache()` only to dedupe calls within one request.
- Always `await` `params`, `searchParams`, `cookies()` and `headers()` (async in Next 16).
- Parse `searchParams` with Zod with defaults (`page=1`, `pageSize=20`) inside the use case; never trust raw strings.

```tsx
// src/app/(dashboard)/users/page.tsx
import { listUsers, UsersTable } from "@/features/users/server";

export default async function UsersPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await listUsers(await searchParams); // use case: Zod-parse query -> gateway
  return <UsersTable data={page} />;
}
```

## Mutations

- All mutations are Server Actions in `features/<domain>/presentation/actions/*.ts` (`"use server"`), re-exported from `server.ts`.
- Each action: (1) validate input with the Zod schema on the server, (2) `requireRole([...])` for the roles in the contract, (3) call the gateway, (4) `revalidatePath` or `revalidateTag` for affected routes, (5) return `{ ok, auditId }` or `{ ok: false, code, fieldErrors }`.
- The client never calls `fetch` to the Go API directly.

```ts
// src/features/users/presentation/actions/user.actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { adminApi } from "@/shared/lib/api/gateway";
import { requireRole } from "@/shared/lib/auth/guard";
import { toActionError } from "@/shared/lib/api/errors";
import { suspendUserInput } from "../../domain/user-input";

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

- **Unit / component (Vitest + Testing Library, jsdom):** every Zod schema in `features/*/domain/` and `features/*/presentation/` (valid, invalid, boundary cases such as reason length 4, 5, 500, 501), every StatusBadge enum mapping, DataTable URL-param logic, ReasonDialog submit gating.
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
- One domain = one `features/<domain>/` folder with the five layers. Shared admin shell/UI pieces go to `shared/` — created only when a second domain needs them.
- Keep UI strings for a feature in one file (`features/<domain>/presentation/copy.ts`) so the UI copy language can be decided later (see OPEN).
- Prefer `unknown` plus Zod parsing at every boundary over casts.

## OPEN

- Node version conflict: Next 16 needs Node ≥ 20.9, while `garden-ai/solutioning/infrastructure/DEPLOYMENT.md` builds the CMS image from `node:18-alpine` (both builder and runtime stages). Do not edit DEPLOYMENT.md here; decide the image Node version with the devops owner before the first Fly deploy.
- Home/overview dashboard (`/`): no spec defines its content.
- Dashboard route for plant support (`GET /plants/:id`, `PATCH /plants/:id/stage`): placement inside `/users/[id]` is a proposal.
- Challenge naming (CMS_ASSESSMENT §18 #2): the CMS uses `/challenges` per the contract; the app path is still open.
- Route names above are proposals; the contract defines paths only for the API.
