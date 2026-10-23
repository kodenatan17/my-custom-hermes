---
name: cms-ui-slicing
description: Slice GROWPICO CMS screens from PNG designs in growpico-cms/design/ - region mapping to shadcn and shared components, Tailwind v4 token extraction, the shared component inventory to build first, and the per-screen Definition of Done.
---

# Skill: cms-ui-slicing

Load order: spec-first → cms-nextjs-architecture → **cms-ui-slicing** → cms-api-contract (for data) and cms-security-boundaries (for roles and the reason dialog).

## Purpose

Turn a PNG design into a working Next.js screen without inventing fields, rules or roles. The user drives the coder by prompt and vibe-codes the CMS, so this skill gives the exact workflow, the shared components to build first, and the checklist that decides whether a screen is done. Slicing is static first: the screen renders with mock data from the adapter, then gets its states verified.

## When to Use

- Building or changing any screen under `growpico-cms/src/app/(dashboard)/` or `(auth)/`.
- Building a shared CMS component in `src/components/shared/`.
- Setting up design tokens in `src/app/globals.css`.

## When Not to Use

- Flutter UI (`seedly_app/`): use the Flutter architecture skills.
- Creating the project or folder structure: `cms-nextjs-architecture`.
- Endpoint and fixture work: `cms-api-contract`.
- Deciding fields, rules or roles: those come from specs, not designs (see "Design vs spec" below).

## Constraints

- **Design source:** PNG exports in `growpico-cms/design/`. Naming: `<domain>-<screen>[-<state>].png`, where `<domain>` is the route slug from the architecture table (e.g. `users-list.png`, `users-detail-suspend-dialog.png`, `missions-edit-empty.png`). Agents read PNGs with the Read tool.
- **Stack is fixed:** Tailwind CSS v4, shadcn/ui (Radix), TanStack Table, React Hook Form + Zod, lucide-react, Recharts (through the shadcn chart wrapper), sonner, date-fns. Do not add another UI kit, icon set, or chart library.
- **No hardcoded colors** in components: no hex, no `rgb()`, no arbitrary Tailwind colors (`bg-[#1e40af]`). Use semantic classes (`bg-primary`, `text-muted-foreground`) or brand tokens from `@theme`.
- **Desktop-first.** Target widths ≥ 1024 px. Below that, the sidebar becomes a sheet. No separate mobile design is required.
- **Server-first:** the page renders as a Server Component. Interactivity lives in small client leaves (see architecture skill).
- **All data comes through the adapter** (mock in slicing). Never put fixture arrays in a page file.

## Design vs spec

| Question | Source that wins |
|---|---|
| Which fields, enums, validation, endpoints, roles, ★ rules | Spec + contract (`api_contracts_cms.md`, `features/cms/*.md`) |
| Layout, spacing, component choice, visual style, states' look | PNG design |
| Copy text (labels, button text) | PNG for now; language is OPEN (see below) |

When they conflict:
- The PNG shows a field the contract does not define → do not implement it; list it in the report.
- The PNG shows an action the role matrix or `Roles:` line forbids → hide it for that role; flag it.
- The PNG shows a Phase 2 or deferred item (e.g. AI config edit, plan/payment screens, notification templates) → omit it; flag it.
- The PNG and the spec disagree on a rule (e.g. reason length) → the spec wins; flag it.
- A PNG is missing for a screen → build from the shared inventory using shadcn defaults; flag "no design".

Do not block on a missing PNG. Do not silently pick a design when two PNGs disagree; report it.

## Slicing workflow (run in order, per screen)

1. **Locate the PNG** and the spec section for the screen: domain spec in `features/cms/` (screen list and field rules) and the contract section (endpoints, roles).
2. **Read the PNG** with the Read tool. Note each state present (default, empty, loading, error, dialog open, row selected).
3. **List regions top to bottom, left to right:** nav, top bar, page header, toolbar, table/cards/form, side panel, dialogs, toasts.
4. **Map every region** to a shadcn primitive or a shared component using the table below. If nothing fits, build a shared component first; do not inline one-off markup.
5. **Extract tokens** (colors, radius, spacing, type scale) into `globals.css` `@theme`. Do this once per design set, not per screen.
6. **Write the static screen** as a Server Component page that calls `adminApi()` through `features/<domain>/api/queries.ts`, with mock data.
7. **Wire the client leaves:** filters (URL), dialogs (RHF + Zod), row actions (role-filtered).
8. **Verify every state** from the checklist below and compare with the PNG side by side (run `npm run dev`, open the route per role in mock mode).
9. **Report deltas** from the PNG, with the reason for each.

Region → component mapping:

| Region in PNG | Component |
|---|---|
| Left navigation | `AppShell` + `Sidebar` (items from `lib/nav.ts`, filtered by role) |
| Top bar (search, account) | `Topbar` (account menu with sign out) |
| Title, breadcrumb, primary action | `PageHeader` |
| Filter row / search box / selects | `FilterToolbar` (inside `DataTable`) |
| Table, sort headers, pager | `DataTable` (TanStack Table, server-side pagination) |
| Status pill (`ACTIVE`, `SUSPENDED`, …) | `StatusBadge` |
| Row `⋯` menu | shadcn `DropdownMenu`, role-filtered |
| Slide-in details | `DetailSheet` (shadcn `Sheet`) |
| Reason-required confirmation | `ReasonDialog` |
| Destructive confirmation without reason | `ConfirmDialog` |
| KPI tiles | `StatCard` |
| Line/bar/area charts | `ChartCard` (shadcn `chart` + Recharts) |
| Empty list | `EmptyState` |
| Failed load | `ErrorState` |
| Loading placeholder | `TableSkeleton`, `CardSkeleton` |
| Role-denied page | `ForbiddenState` |
| Form field with label/error | `FormField` (RHF `Controller` + shadcn `Form`) |
| Success/error notification | sonner `toast` (success toast carries the `auditId` link) |

## Shared component inventory (build in this order)

Build these before any domain screen. Put them in `src/components/shared/`. Each one has a unit test for its states.

1. **AppShell / Sidebar / Topbar.** Reads `{ id, email, displayName, role }` from the dashboard layout. Nav items come from `lib/nav.ts` with allowed roles per item; items the role cannot use are not rendered. Active state from `usePathname()`.
2. **PageHeader.** Props: `title`, `description?`, `breadcrumbs?`, `actions?` (ReactNode, already role-filtered by the caller).
3. **DataTable.** Props: `columns`, `data: Page<T>`, `query` (parsed search params), `filters` (config list), `rowHref?`. Behavior:
   - Pagination: `page` and `pageSize` (choices 10/20/50/100; max 100) written to the URL. Show `total`.
   - Filters: each filter writes its search param; changing any filter resets `page=1`.
   - Sort: **not in the contract**. Build the header UI with `sort` and `order` URL params (proposed names). Enable only when the API documents sort. OPEN.
   - Empty and loading states are handled by the table, not the page.
   - Row click opens a detail route or `DetailSheet`. Row actions are a `DropdownMenu` filtered by role.
4. **StatusBadge.** Props: `value` (contract SNAKE_CASE enum), `map` (value → variant + label key). Always shows text, never color alone. Unknown value → neutral badge with the raw enum (no crash).
5. **ReasonDialog.** For every ★ mutation. Uses the shared schema:

```tsx
"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { reasonSchema } from "@/lib/api/contract";

const schema = z.object({ reason: reasonSchema });   // 5–500 chars, trimmed (see cms-api-contract)
type Values = z.infer<typeof schema>;

export function ReasonDialog({ open, onOpenChange, title, submitLabel, destructive, onSubmit }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; submitLabel: string;
  destructive?: boolean; onSubmit: (reason: string) => Promise<{ ok: boolean; auditId?: string; fieldErrors?: { reason?: string[] } }>;
}) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { reason: "" }, mode: "onChange" });
  const len = form.watch("reason").trim().length;
  // Render: textarea with a live counter "len/500", submit disabled until valid.
  // On submit: await onSubmit(values.reason); on ok -> close + toast with auditId;
  // on fieldErrors.reason -> form.setError("reason", ...). Never close on error.
  return null; // (illustrative — implement with shadcn Dialog, Form, Textarea, Button)
}
```

   Rules: the dialog never closes on error; the counter shows `n/500`; `422 reason_required` maps to the empty-field message; the dialog does not pre-fill the reason.
6. **ConfirmDialog.** For destructive actions that are not ★ (e.g. deleting a draft). Title, description, confirm and cancel labels. Focus lands on cancel by default.
7. **DetailSheet.** Shadcn `Sheet` with header, tabs (Details, History from `GET /audit-logs/entity/:type/:id`), and footer actions (role-filtered).
8. **FormField.** Wraps shadcn `FormItem`/`FormLabel`/`FormControl`/`FormMessage` for RHF + Zod. Props: `name`, `label`, `description?`, `control`, `children` (input). Shows server `fieldErrors` the same way as client errors.
9. **EmptyState / ErrorState / ForbiddenState / skeletons.** `ErrorState` shows the mapped message, a retry button (`router.refresh()`), and the request id when present. `ForbiddenState` says the role lacks access and offers a link back to the dashboard. Skeletons match the final layout heights.
10. **StatCard and ChartCard.** `StatCard`: label, value, delta, optional range label (`7d|30d|90d`). `ChartCard`: wraps shadcn `ChartContainer`; accepts `config` and `data`; shows an empty state when `data` is empty. Used for analytics, AI usage and IoT.
11. **Toaster.** One `<Toaster />` in the root layout. Mutation success toast: "Saved" plus an action "View audit" linking to `/audit-logs/[auditId]`. Error toasts show the mapped message only.

## Design tokens and theming

- Start from shadcn's CSS variables in `globals.css` (`--background`, `--foreground`, `--primary`, `--muted`, `--muted-foreground`, `--destructive`, `--border`, `--ring`, `--card`, `--sidebar-*`). Keep light and dark definitions both.
- Extract the PNG palette once into brand tokens and map them through `@theme inline`:

```css
/* src/app/globals.css (excerpt) */
@import "tailwindcss";
@import "tw-animate-css";

@theme inline {
  --color-brand-600: var(--brand-600);     /* values OPEN until the designer confirms */
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-info: var(--info);
}

:root {
  --brand-600: oklch(0.55 0.13 150);       /* placeholder, not from design */
  --success: oklch(0.62 0.15 150);
  --warning: oklch(0.75 0.15 80);
  --info: oklch(0.6 0.12 240);
}
```

- Use semantic classes in components: `bg-card`, `text-muted-foreground`, `border-border`, `bg-brand-600`, `text-success`. Never a hex.
- Radius, spacing and type come from the design PNG. Map them to `--radius` and Tailwind spacing (4 px grid); avoid arbitrary `p-[13px]`.
- Font: use the `next/font` font created by `create-next-app` unless the design names one. Font choice is OPEN.
- Charts: use token colors through `chart` `config` (`var(--chart-1)` … `var(--chart-5)` from shadcn).

## Definition of Done (per screen)

A screen is done only when every item passes.

**States**
- [ ] Loading: skeleton with the final layout height (no layout shift when data arrives).
- [ ] Empty: `EmptyState` with a message and, if the role may create, a primary action.
- [ ] Error: `ErrorState` with retry; request id shown when available.
- [ ] Forbidden: `ForbiddenState` when the API returns `403 forbidden_role`.
- [ ] Not found: `not-found.tsx` for a missing `[id]`.
- [ ] Each state rendered in mock mode (use `CMS_MOCK_LATENCY_MS` and the mock role picker to reach them).

**Roles**
- [ ] Every action is hidden for roles not in its `Roles:` line; hiding is done in one place (nav/role table).
- [ ] The server action checks the same roles (`requireRole`).

**Mutations**
- [ ] Every ★ action opens `ReasonDialog`; submit is disabled until 5–500 characters.
- [ ] Non-★ destructive actions use `ConfirmDialog`.
- [ ] Success toast shows the `auditId` link; failure shows the mapped message and keeps the dialog open.
- [ ] Pending state disables the submit button (no double submit).

**Accessibility and input**
- [ ] Every input has a visible label; errors are announced (`aria-invalid`, described by message).
- [ ] Keyboard: all actions reachable with Tab; dialogs trap focus and close on Esc; table row actions are buttons, not click-only divs.
- [ ] Focus ring visible in light and dark.
- [ ] Status is shown with text (StatusBadge), not color alone.
- [ ] Icon-only buttons have an `aria-label`.

**Layout**
- [ ] Verified at 1024 px and 1440 px width. No horizontal page scroll; table scrolls inside its container.
- [ ] Tokens only: no hex, no arbitrary color values, no inline `style` for colors.
- [ ] Dates shown in UTC with a visible label; numbers use thousands separators.
- [ ] Copy comes from the feature's `copy.ts`.

**Tests and scripts**
- [ ] Zod schemas for the screen have tests (valid, invalid, boundary).
- [ ] One component test covers the empty and error states.
- [ ] `typecheck`, `lint`, `test` pass.

## Dashboard home and roles

- The dashboard home (`/`) is OPEN: no spec defines its content. Build a placeholder with only the links the current role may open. Do not invent KPIs.

## OPEN

- **UI copy language.** The specs are Indonesian; this skill and the code are English. Not decided. Keep all strings in `copy.ts` so the decision is a single-file change.
- **Brand palette, typography and logo.** Not in specs. Use the PNG values once the designer confirms; placeholders above are not from design.
- **Sort parameters.** The contract has no sort fields. The UI pattern is proposed, not API-backed.
- **Design file set.** The domain-to-PNG list is not defined. Use the naming rule; do not invent screen names that a PNG does not show.
- **Responsive below 1024 px.** Not specified; desktop-first is the assumption.
- **Dark mode.** Not specified. Tokens support it, but the requirement is OPEN.
