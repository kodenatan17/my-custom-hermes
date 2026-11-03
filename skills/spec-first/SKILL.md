---
name: spec-first
description: Resolve a Seedly task to the exact spec files under garden-ai/solutioning/specs/ (spec map with a Project column for APP, CMS and BE, plus the known unsynced specs) and follow them; never invent business rules.
---

# Skill: spec-first

## Purpose

Seedly has a mature, pre-existing specification set at `garden-ai/solutioning/specs/` covering every feature, domain, architecture decision, and API contract. Before touching any feature-related task, the agent must resolve the task to the concrete spec file(s) that already answer "what must be built" and read them — never guess, never invent business rules, never assume a generic/textbook implementation. Specs are the single source of truth; this skill is the discipline that keeps the agent from drifting away from it.

## When to Use

- Any task that touches a product feature, business rule, data shape, or user-facing behavior (feature, bugfix, refactor, review, solutioning commands).
- Before delegating to architect or coder.

## When Not to Use

- Pure infrastructure/tooling tasks with no product behavior (e.g. CI pipeline syntax fix, dependency bump) — still resolve if in doubt, but skip if the spec map below has no match and the task is clearly non-product.

## Constraints

- Never implement a business rule, threshold, enum, or workflow step that isn't stated in a spec file — if it's missing, that's a gap to flag, not a gap to fill by assumption.
- Never silently resolve a conflict between two spec files — surface it (`STATUS: NEEDS_REVISION`), mirroring the architect's spec-mode rule.
- **BE conflict rule:** if a spec conflicts with `growpico-be/docs/` or with the code in `growpico-be/`, the BE docs and code win until the spec is synced. Report the conflict; do not edit the spec from code work. (On 2026-11-02 the specs for architecture, API architecture, database design and the backend contract were synced to the BE docs and code; specs outside that sync are listed under Known Unsynced Specs.)
- Always cite the exact spec file + section backing a design/implementation decision when reporting back.
- If the spec map has no match, search `garden-ai/solutioning/README.md` (the doc map) for the right file before proceeding — never start implementation with zero resolved specs on a feature task.

## Depends On

None — this is the foundational skill; every other skill assumes the relevant spec has already been read.

## Source References

- `garden-ai/solutioning/README.md` — the doc map; authoritative index of every spec file and its purpose.
- `garden-ai/solutioning/specs/features/*.md` — 13 feature specs, each with a "Database Changes", "API Contracts", "Error & Edge Cases", "Acceptance Criteria" structure that is the actual source of truth for that feature.
- Backend skills: `be-architecture`, `be-api-contract`, `be-database`, `be-security-boundaries` (BE work in `growpico-be/`).

## Conventions

- Resolve the task's domain keyword against the spec map below to get the exact file path(s) — do not re-derive this mapping ad hoc, and read only those files.
- **Project column:** `APP` = Seedly Flutter app (`seedly_app/`), `CMS` = GROWPICO CMS (`growpico-cms/`), `BE` = Go backend (`growpico-be/`). A row can list more than one project. The column says which project the spec governs, not where the spec lives.
- Read the full feature spec file, not just its "API Contracts" section — the "Database Changes", "Assumptions & Unresolved Decisions", and "Out of Scope" sections are equally load-bearing.
- When a feature spec cross-references another doc (e.g. "see profiling-user-feature.md#migration-strategy"), follow the link — specs are deliberately non-duplicative and push shared concerns to one canonical doc.
- When a spec explicitly marks something "Open" / "Unresolved Decision" / "TBD", do not resolve it yourself — implement around it conservatively and flag it in the output.
- Treat `garden-ai/solutioning/specs/contracts/api_contracts_backend.md` and `api_contracts_cms.md` as the API source of truth over any inference from a feature doc's own inline examples, if the two ever disagree (the contracts docs are the consolidated, cross-checked version). The backend contract's §6 open questions (Q#1–42) must not be decided silently.

## Spec map (keyword → project → files under `garden-ai/solutioning/specs/`)

| Keyword | Project | Spec file(s) |
|---|---|---|
| achievement / mastery | APP, CMS | features/achievement-feature.md, features/cms/achievement_management.md |
| mission (career) | APP, CMS | features/mission-feature.md, features/cms/mission_management.md |
| quest / challenge (daily-weekly) | APP, CMS | features/experience-gamification-feature.md, domain/apps/CHALLENGE_ENGINE.md, features/cms/mission_management.md |
| xp / level / gamification | APP, BE | features/experience-gamification-feature.md, domain/apps/GAMIFICATION.md |
| sequence: xp economy · missions · achievements & mastery | APP, BE | features/sequences/SEQ-05-xp-economy.md, SEQ-09-missions.md, SEQ-10-achievements-mastery.md |
| chat / ai consultant | APP, BE | features/chat-ai-consulte.md, domain/be/AI_PROVIDER_STRATEGY.md, domain/be/PLANT_INTELLIGENCE.md |
| sequence: ai consultant · ai quota | APP, BE | features/sequences/SEQ-06-ai-consultant.md, SEQ-08-ai-quota.md |
| growth / journey / report | APP, BE | features/report-growth-consule-features.md, domain/apps/PLANT_SCORE.md, features/cms/master_data_growth_journey.md |
| sequence: growth check | APP, BE | features/sequences/SEQ-04-growth-check.md |
| sensor / telemetry / environment | APP, BE, CMS | features/data-sensor-features.md, domain/sensor/IOT_ARCHITECTURE.md, features/cms/iot_monitoring.md |
| sequence: telemetry (iot → backend) | BE | features/sequences/SEQ-03-telemetry.md |
| device pairing / setup | APP, BE, CMS | features/device-setup-pairing.md, features/cms/master_data_device.md |
| installation / calibration | APP, BE | features/installation-feature.md |
| iot lifecycle / power / sleep | BE | features/iot-lifecycle-feature.md |
| add seed / plant / container | APP, BE, CMS | features/add-seed-feature.md, features/cms/master_data_seed_product.md |
| sequence: onboarding · plant creation · garden home | APP, BE | features/sequences/SEQ-01-onboarding.md, SEQ-02-plant-creation.md, SEQ-07-garden-home.md |
| profiling / auth / login / session | APP, BE | features/profiling-user-feature.md, features/authentication-feature.md |
| assessment / guided camera / photo validation | APP, BE | features/assessment-feature.md, domain/apps/GUIDED_CAMERA.md, domain/be/AI_IMAGE_VALIDATION.md (unsynced) |
| social / sharing | APP | domain/apps/SOCIAL.md |
| cms / admin (index) | CMS | features/cms/CMS_ASSESSMENT.md, domain/apps/CMS.md; CMS build skills: cms-nextjs-architecture (routes, build order), cms-ui-slicing, cms-api-contract, cms-security-boundaries |
| cms architecture | CMS | architecture/cms/ARCHITECTURE_DECISIONS.md |
| cms user / support / suspend / xp correction / gdpr | CMS | features/cms/master_data_user.md (contract §4) |
| cms device / revoke / release / factory batch | CMS | features/cms/master_data_device.md (contract §5) |
| cms species / care profile / seed kit | CMS | features/cms/master_data_seed_product.md (contract §2–3) |
| cms growth template / journey stage | CMS | features/cms/master_data_growth_journey.md (contract §6) |
| cms mission / challenge / quest (definitions) | CMS | features/cms/mission_management.md (contract §7–9) |
| cms achievement / mastery tier / level | CMS | features/cms/achievement_management.md (contract §10) |
| cms learning question / mcq | CMS | features/cms/learning_content_management.md (contract §11) |
| cms ai usage / quota / config | CMS | features/cms/ai_management.md (contract §14) |
| cms iot fleet / offline device / abnormal reading | CMS | features/cms/iot_monitoring.md (contract §15) |
| cms analytics / metrics dashboard | CMS | features/cms/analytics.md (contract §16) |
| cms admin user / role / rbac / admin login | CMS | features/cms/admin_access_control.md (contract §1.2, §12) |
| cms audit / audit log | CMS | features/cms/audit_log.md (contract §13) |
| api / contract | BE, CMS | contracts/api_contracts_backend.md (app + account, garden, growth, experience, ai; §6 open questions), contracts/api_contracts_iot.md (device), contracts/api_contracts_cms.md (admin) |
| backend layout / modules / build order | BE | domain/be/BACKEND_ARCHITECTURE.md, code: `growpico-be/internal/` (skill: be-architecture) |
| backend api conventions / namespaces / rate limits | BE | domain/be/API_ARCHITECTURE.md (§9.5 flat route map is superseded) |
| database / schema / migration | BE | domain/be/DATABASE_DESIGN.md (inventory); schema truth `growpico-be/db/migrations/` (skill: be-database) |
| architecture / module boundary | BE, APP, CMS | architecture/be/ARCHITECTURE_DECISIONS.md, architecture/apps/ARCHITECTURE_DECISIONS.md, architecture/cms/ARCHITECTURE_DECISIONS.md, architecture/sensor/ARCHITECTURE_DECISIONS.md |
| notification | BE, APP | domain/be/NOTIFICATIONS.md (unsynced) |
| mvp scope / roadmap | APP, BE, CMS | mvp/MVP_SCOPE.md (unsynced), ROADMAP.md |
| backend minimum stack / free-tier / deploy / backend dev plan | BE | growpico-be/docs/MINIMUM_STACK.md (stack, JWT design), DEVELOPMENT_PLAN_READY.md (phases; partly stale), DISCUSSION_NEEDED.md, DATABASE_SCHEMA_NOTES.md (contract → table, deviations), CONTRACT_GAP_RESOLUTION.md (proposals) |

The whole spec set is ~690 KB — never read it wholesale. Open the mapped files, and follow cross-references only when the task needs them.

## Known Unsynced Specs

These still describe something other than the current backend (2026-11-02). Use the BE docs and code, and flag the conflict.

| Spec | What is stale |
|---|---|
| `mvp/MVP_SCOPE.md` | Says "Auth (Firebase, email + Google)". Backend auth is own email + password; Google and password reset are deferred (`MINIMUM_STACK.md` M2). |
| `domain/be/NOTIFICATIONS.md` | Describes Asynq queues and FCM push. Backend uses a Postgres `jobs` table and an in-app inbox polled from `notification_logs`; push is deferred. |
| `domain/be/AI_IMAGE_VALIDATION.md` | Describes Asynq `validate-image`, R2 storage and EXIF pipeline. Photo storage and AI validation are deferred (M3, decision 9). |
| `architecture/apps/ARCHITECTURE_DECISIONS.md` | Contains Firebase and FCM references (about 18 matches). Not part of the 2026-11-02 sync, per the note in `architecture/be/ARCHITECTURE_DECISIONS.md`. |
| `contracts/api_contracts_cms.md` §1.2 and `domain/apps/CMS.md` (Auth bullet) | Admin login through a Firebase ID token (`{firebaseIdToken}`; CMS.md says Firebase Admin verifies the account). `MINIMUM_STACK.md` §7 says admin uses email and password with its own secret. Conflicts with the BE docs; BE docs win until synced. |
| `features/**` (23 files, including `sequences/` and `cms/`, e.g. `authentication-feature.md`, `profiling-user-feature.md`) | Still mention Firebase, FCM or Asynq in places. Not reviewed line by line in the 2026-11-02 check. |
| `infrastructure/infra-backend/DATABASE_SCHEMA.sql` | Placeholder with a Prisma header and `firebase_uid NOT NULL`. Not the schema. Use `growpico-be/db/migrations/`. |
| `contracts/api_contracts_cms.md` §1.5 | Error envelope `{ "error": { ... } }` differs from the BE envelope `{ "status": { ... } }`. Open. |
| `domain/be/API_ARCHITECTURE.md` §9.5 | Marked superseded inside the file by the namespaced contract. The flat routes must not be implemented. |
| `ROADMAP.md` (line 5) | Plans a Firebase project (Auth, FCM) and Fly.io + Upstash + R2 provisioning. Backend runs on Render + Aiven with own auth, a Postgres `jobs` table and no photo storage (`MINIMUM_STACK.md`). |
| `architecture/sensor/ARCHITECTURE_DECISIONS.md` (~lines 41, 101, 112, 206) | Says "Go API (Gin)" and "Custom auth — Firebase is fine and faster" / "Firebase for auth + push; Ent; Fly.io". Backend is `net/http` (Go 1.22 ServeMux), own email + password auth, `database/sql`, Render. |
| `architecture/cms/ARCHITECTURE_DECISIONS.md` (~line 185) | Mock identity resolved from a synthetic `firebaseIdToken`, i.e. it follows the CMS contract's Firebase admin login (§1.2), not `MINIMUM_STACK.md` §7 email + password admin login. |

## Spec-First Checklist for Agents

1. Find the keyword row. Note the Project column.
2. Open the mapped spec(s). For BE work, also open the matching `growpico-be/docs/` file and the code.
3. Check the Known Unsynced list. If your spec is there, say so in the report.
4. Check the contract §6 open questions for the endpoint. If one applies, stop and report.
5. Report: spec path + section per decision, and every conflict or open item.
