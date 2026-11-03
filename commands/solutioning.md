---
description: Specs/solutioning work: architect → documenter (documenter only for doc-only tasks)
agent: hermes
---

Route: solutioning
Solutioning: <request>$ARGUMENTS</request>

Pick one route:
- documentation-only (update/move/rename docs, README doc map, CHANGELOG): documenter(spec) only.
- spec/design question or change: architect(spec) → documenter(spec) only if files must be created/updated.
Pass documenter only the file list and required changes — never ask it to audit the whole solutioning tree.
Project detection: name the project whose specs change (APP · CMS · BE, or several) in every delegation as `Project: …`; `growpico-iot/` firmware specs stay read-only context.
Skills for the agents: spec-first; for BE specs also be-architecture / be-api-contract / be-database; for CMS specs cms-nextjs-architecture / cms-api-contract.

Lean handoff (applies to every delegation of this route): give each agent only what it needs — the goal in one line, `Project:`, exact file paths with line ranges when known, the earlier step's findings (not its whole output), and the skills to load by name (none if not needed). Do not ask an agent to explore beyond its step, to "also check" other areas, or to add abstractions, options, tests or docs the request did not ask for. Each agent works within its own tool budget and stops with PARTIAL rather than sprawling; a reviewer's non-blocking SUGGESTIONS are reported to the user, not sent back to the coder.
