---
name: flutter-client-architecture
description: Architecture conventions for the Seedly Flutter app: Bloc, go_router, lib/features/{domain} layout, DI.
---

# Skill: flutter-client-architecture

## Purpose

The Seedly Flutter app (`seedly_app/`) is built on Bloc + go_router with a per-feature folder convention (`lib/features/{domain}/`), established by the `mission` feature as the reference implementation. This skill encodes the architecture decisions already made for it, so new code follows the intended pattern rather than whatever a generic Flutter tutorial suggests.

## When to Use

- Any task creating or modifying code under `seedly_app/lib/`.
- Any task involving app-side state, navigation, or screen composition.

## When Not to Use

- Backend, CMS, or firmware work with no Flutter code involved.

## Constraints

- State management is **Bloc** (`flutter_bloc`) — do not introduce Riverpod, Provider (the older package), GetX, or a bespoke `InheritedWidget` pattern.
- Navigation is **go_router** — do not introduce `Navigator` push/pop chains as the primary navigation mechanism, or a second routing package.
- **The app never enforces business rules.** It renders server-computed values (XP, level, score, mission/quest status, mastery tier) — it must never compute or locally override any of these; a local optimistic update, if used, must be reconciled against the next server response, never treated as final.
- The app holds no secrets and never verifies its own Firebase claims — it only forwards the Firebase ID token / SEEDLY access token to the backend.
- New feature code lives under `lib/features/{domain}`, named after the same domain noun the specs use for that feature — not after the screen name. A feature folder does not have to map 1:1 to a single `{domain}-feature.md` spec: closely related, overlapping sub-capabilities are grouped under one broader boundary rather than each getting its own top-level feature (e.g. `mission`, `quest`, `achievement`, `mastery`, `xp`/`level`, and `learning` all live under `lib/features/experience/`, since splitting them into separate top-level features would make each one too narrow and the boundaries too overlapping to hold cleanly). Only split a capability into its own feature folder when it doesn't share this kind of tight coupling with an existing one.

### Feature folder layout

Every feature follows this layer structure (see `lib/features/experience/` for the
reference implementation — it currently holds only the Mission capability; Quest,
Achievement, Mastery, XP/Level, and Learning land in the same folder later):

```
features/{domain}/
├── applications/        # entities, repository interfaces (ports), use cases
│   ├── entities/
│   ├── repositories/
│   └── usecases/
├── infrastructure/       # data sources, repository implementations, DTO mappers (adapters)
│   ├── datasources/
│   ├── mappers/
│   └── repositories/
├── presentation/
│   ├── bloc/
│   ├── pages/
│   ├── widgets/
│   └── routes/          # this feature's GoRoute/ShellRoute definitions
├── di/                   # `{domain}_module.dart` — registers into the global `getIt`
└── public_api.dart       # the ONLY file other code may import from this feature
```

`applications/` and `infrastructure/` are the ports-and-adapters split: `applications/`
is framework-agnostic business logic (what `domain/` + use cases used to be called),
`infrastructure/` is the adapters that implement `applications/repositories/*`
against a real transport (what `data/` used to be called). Internal files
(data sources, mappers, repository impls, widget internals) stay private —
`public_api.dart` re-exports only what other features/the app shell need
(screens, routes, entities, bloc contracts, the DI module).

### Navigation / go_router ownership

- **Core owns the single global `GoRouter`** (`lib/cores/router/app_router.dart` —
  a generic shell: error page, router construction). Core never references a
  feature's routes.
- **Each feature owns its own route definitions** (`presentation/routes/`) and
  exposes them through `public_api.dart` (e.g. `missionRoutes()`,
  `MissionRoutePaths`). A feature must never construct its own `GoRouter` —
  only contribute a `List<RouteBase>`.
- **The app composition root** (`lib/app.dart`) is the one place allowed to
  import multiple features' `public_api.dart` at once; it spreads every
  feature's routes into the global router built by `cores/router/app_router.dart`.
- **Route builders never instantiate repositories/services/use cases by
  hand.** They resolve Blocs via the existing DI container (`getIt<XBloc>()`,
  registered by that feature's `di/{domain}_module.dart`) — the same pattern
  used everywhere else in the app.
- Screens stay navigation-agnostic: they take host-supplied callbacks
  (`onXSelected`, `onOpenY`) rather than importing `go_router` themselves.
  The `routes/` file is the only place in a feature allowed to import
  `go_router` and translate a callback into `context.push(...)`.
- If two screens must share one Bloc instance across a push (e.g. a list and
  its detail view reading the same in-memory state), nest them under a
  `ShellRoute` that provides the Bloc once, rather than giving each route its
  own instance.

## Depends On

- `api-contract-conventions` (how the app calls the backend: cursor pagination, `Idempotency-Key` on mutations, Bearer auth).
- `security-boundaries` (token handling, never trusting locally-held state).
- `spec-first` (each feature folder's behavior comes from its feature spec's "App Screens" section, not from invention).

## Source References

- `garden-ai/solutioning/specs/architecture/apps/ARCHITECTURE_DECISIONS.md` — decision #7 (Bloc), #8 (go_router), "The app renders a read/projection view of the backend model... never enforces business rules... App is a projection surface, not a trust boundary."
- `garden-ai/solutioning/specs/domain/apps/GUIDED_CAMERA.md` — a concrete app-side subsystem spec'd in detail (capture → local checks → upload → poll → result), useful background for a feature not yet built.
- `seedly_app/lib/features/experience/` — the reference implementation of the feature folder layout, DI module pattern, and route composition described above (currently Mission only). Read this first when structuring a new feature.
- `seedly_app/lib/cores/dependency/injection.dart` — the single DI file: the global `getIt` container and `registerCoreDependencies()` (Core's own capabilities + every feature module's `di/*_module.dart`), called once from `main()`. There is no separate app-level DI file.
- `seedly_app/lib/cores/router/app_router.dart`, `seedly_app/lib/app.dart` — the Core router shell and the app composition root that composes feature routes into it.

## Conventions

- When starting a new feature folder, check the matching feature spec's "App Screens" table first (most specs have one) for the exact screen list and what each screen reads/writes.
- Prefer composition over inheritance, strongly-typed models (consider `freezed`/immutable data classes once introduced), and reusable widgets — avoid duplicating business logic client-side that the backend already computes.
- Any local persistence (offline camera queue, draft state) is a UX convenience only — it must never become the source of truth for a value the backend owns.
- `lib/cores/` is for cross-feature infrastructure (DI wiring, networking client, theme) — feature-specific logic does not belong there.
