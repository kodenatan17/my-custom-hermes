# Skill: spec-first

## Purpose

Seedly has a mature, pre-existing specification set at `garden-ai/solutioning/specs/` covering every feature, domain, architecture decision, and API contract. Before touching any feature-related task, the agent must resolve the task to the concrete spec file(s) that already answer "what must be built" and read them — never guess, never invent business rules, never assume a generic/textbook implementation. Specs are the single source of truth; this skill is the discipline that keeps the agent from drifting away from it.

## When to Use

- Any task that touches a product feature, business rule, data shape, or user-facing behavior (feature, bugfix, refactor, review, solutioning commands).
- Before delegating to any implementation agent (architect, planner, coder, editor, fixer).

## When Not to Use

- Pure infrastructure/tooling tasks with no product behavior (e.g. CI pipeline syntax fix, dependency bump) — still resolve if in doubt, but skip if the orchestrator's Spec Resolution table has no match and the task is clearly non-product.

## Constraints

- Never implement a business rule, threshold, enum, or workflow step that isn't stated in a spec file — if it's missing, that's a gap to flag, not a gap to fill by assumption.
- Never silently resolve a conflict between two spec files — surface it (`STATUS: NEEDS_REVISION`), mirroring the `solutioning` subagent's own rule.
- Always cite the exact spec file + section backing a design/implementation decision when reporting back.
- If the orchestrator's keyword table has no match, search `garden-ai/solutioning/specs/` (via finder) before proceeding — never start implementation with zero resolved specs on a feature task.

## Depends On

None — this is the foundational skill; every other skill assumes the relevant spec has already been read.

## Source References

- `garden-ai/solutioning/README.md` — the doc map; authoritative index of every spec file and its purpose.
- `.opencode/agents/subagents/solutioning/solutioning.md` — "Never invent business rules. Never assume requirements... When conflicts exist: STATUS: NEEDS_REVISION. Document the conflict."
- `garden-ai/solutioning/specs/features/*.md` — 13 feature specs, each with a "Database Changes", "API Contracts", "Error & Edge Cases", "Acceptance Criteria" structure that is the actual source of truth for that feature.

## Conventions

- Resolve the task's domain keyword against the orchestrator's Spec Resolution table (in `orchestrator.md`) to get the exact file path(s) — do not re-derive this mapping ad hoc.
- Read the full feature spec file, not just its "API Contracts" section — the "Database Changes", "Assumptions & Unresolved Decisions", and "Out of Scope" sections are equally load-bearing.
- When a feature spec cross-references another doc (e.g. "see profiling-user-feature.md#migration-strategy"), follow the link — specs are deliberately non-duplicative and push shared concerns to one canonical doc.
- When a spec explicitly marks something "Open" / "Unresolved Decision" / "TBD", do not resolve it yourself — implement around it conservatively and flag it in the output.
- Treat `garden-ai/solutioning/specs/contracts/api_contracts_backend.md` and `api_contracts_cms.md` as the API source of truth over any inference from a feature doc's own inline examples, if the two ever disagree (the contracts docs are the consolidated, cross-checked version).
