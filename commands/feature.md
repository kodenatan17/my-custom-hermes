---
description: Build a feature: scout → coder → reviewer (+qa, +architect when needed)
agent: orchestrator
---

Feature request: <request>$ARGUMENTS</request>

Classify, then run exactly one route:
- small (one layer, existing pattern): scout(find) → coder(implement) → reviewer
- medium (several layers or new state flow): scout(analyze) → coder(implement) → reviewer → qa
- architecture (new module, contract, routing or DI change): scout(analyze) → architect(design+plan) → coder(implement) → reviewer → qa

Load skills: spec-first, plus flutter-client-architecture / api-contract-conventions / security-boundaries only if the task touches them.
