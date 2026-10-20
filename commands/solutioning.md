---
description: Specs/solutioning work: architect → documenter (documenter only for doc-only tasks)
agent: orchestrator
---

Solutioning: <request>$ARGUMENTS</request>

Pick one route:
- documentation-only (update/move/rename docs, README doc map, CHANGELOG): documenter(spec) only.
- spec/design question or change: architect(spec) → documenter(spec) only if files must be created/updated.
Pass documenter only the file list and required changes — never ask it to audit the whole solutioning tree.
Load skill: spec-first.
