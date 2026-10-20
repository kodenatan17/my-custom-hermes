---
name: spec-first
description: Resolve a Seedly task to the exact spec files under garden-ai/solutioning/specs/ (spec map inside) and follow them; never invent business rules.
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
- Always cite the exact spec file + section backing a design/implementation decision when reporting back.
- If the spec map has no match, search `garden-ai/solutioning/README.md` (the doc map) for the right file before proceeding — never start implementation with zero resolved specs on a feature task.

## Depends On

None — this is the foundational skill; every other skill assumes the relevant spec has already been read.

## Source References

- `garden-ai/solutioning/README.md` — the doc map; authoritative index of every spec file and its purpose.
- `garden-ai/solutioning/specs/features/*.md` — 13 feature specs, each with a "Database Changes", "API Contracts", "Error & Edge Cases", "Acceptance Criteria" structure that is the actual source of truth for that feature.

## Conventions

- Resolve the task's domain keyword against the spec map below to get the exact file path(s) — do not re-derive this mapping ad hoc, and read only those files.
- Read the full feature spec file, not just its "API Contracts" section — the "Database Changes", "Assumptions & Unresolved Decisions", and "Out of Scope" sections are equally load-bearing.
- When a feature spec cross-references another doc (e.g. "see profiling-user-feature.md#migration-strategy"), follow the link — specs are deliberately non-duplicative and push shared concerns to one canonical doc.
- When a spec explicitly marks something "Open" / "Unresolved Decision" / "TBD", do not resolve it yourself — implement around it conservatively and flag it in the output.
- Treat `garden-ai/solutioning/specs/contracts/api_contracts_backend.md` and `api_contracts_cms.md` as the API source of truth over any inference from a feature doc's own inline examples, if the two ever disagree (the contracts docs are the consolidated, cross-checked version).

## Spec map (keyword → files under `garden-ai/solutioning/specs/`)

| Keyword | Spec file(s) |
|---|---|
| achievement / mastery | features/achievement-feature.md, features/cms/achievement_management.md |
| mission (career) | features/mission-feature.md, features/cms/mission_management.md |
| quest / challenge (daily-weekly) | features/experience-gamification-feature.md, domain/apps/CHALLENGE_ENGINE.md, features/cms/mission_management.md |
| xp / level / gamification | features/experience-gamification-feature.md, domain/apps/GAMIFICATION.md |
| chat / ai consultant | features/chat-ai-consulte.md, domain/be/AI_PROVIDER_STRATEGY.md, domain/be/PLANT_INTELLIGENCE.md |
| growth / journey / report | features/report-growth-consule-features.md, domain/apps/PLANT_SCORE.md, features/cms/master_data_growth_journey.md |
| sensor / telemetry / environment | features/data-sensor-features.md, domain/sensor/IOT_ARCHITECTURE.md, features/cms/iot_monitoring.md |
| device pairing / setup | features/device-setup-pairing.md, features/cms/master_data_device.md |
| installation / calibration | features/installation-feature.md |
| iot lifecycle / power / sleep | features/iot-lifecycle-feature.md |
| add seed / plant / container | features/add-seed-feature.md, features/cms/master_data_seed_product.md |
| profiling / auth / login / session | features/profiling-user-feature.md, features/authentication-feature.md |
| assessment / guided camera / photo validation | features/assessment-feature.md, domain/apps/GUIDED_CAMERA.md, domain/be/AI_IMAGE_VALIDATION.md |
| social / sharing | domain/apps/SOCIAL.md |
| cms / admin | features/cms/CMS_ASSESSMENT.md (index → matching sub-file) |
| api / contract | contracts/api_contracts_backend.md (app+device) or contracts/api_contracts_cms.md (admin) |
| database / schema / migration | domain/be/DATABASE_DESIGN.md, infrastructure/infra-backend/DATABASE_SCHEMA.sql |
| architecture / module boundary | architecture/{be,apps,sensor}/ARCHITECTURE_DECISIONS.md |
| notification | domain/be/NOTIFICATIONS.md |
| mvp scope / roadmap | mvp/MVP_SCOPE.md, ROADMAP.md |

The whole spec set is ~690 KB — never read it wholesale. Open the mapped files, and follow cross-references only when the task needs them.
