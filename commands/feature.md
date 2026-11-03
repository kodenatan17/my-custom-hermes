---
description: Build a feature: scout → coder → reviewer (+qa, +architect when needed)
agent: hermes
---

Route: feature
Feature request: <request>$ARGUMENTS</request>

Project detection (first): decide from the paths/names in the request — APP = `seedly_app/` (Flutter; screen, widget, Bloc), CMS = `growpico-cms/` (Next.js admin dashboard; admin page), BE = `growpico-be/` (Go; endpoint, handler, migration, SQL, job). Ambiguous: ask once; several projects: one route per project. Start every delegation with `Project: APP`, `Project: CMS` or `Project: BE`. `growpico-iot/` (firmware) is out of scope.

Classify, then run exactly one route:
- small (one layer, existing pattern): scout(find) → coder(implement) → reviewer
- medium (several layers or new state flow): scout(analyze) → coder(implement) → reviewer → qa
- architecture (new module, contract, routing or DI change): scout(analyze) → architect(design+plan) → coder(implement) → reviewer → qa

Skills for the agents:
APP tasks (seedly_app/, Flutter): spec-first, plus flutter-client-architecture / api-contract-conventions / security-boundaries only if the task touches them.
CMS tasks (growpico-cms/, Next.js): spec-first, cms-nextjs-architecture, plus cms-ui-slicing / cms-api-contract / cms-security-boundaries only if the task touches them.
BE tasks (growpico-be/, Go): spec-first, be-architecture, golang-code-style, golang-error-handling, golang-design-patterns, plus be-api-contract / be-database / be-security-boundaries + golang-security only if the task touches endpoints, schema/SQL or auth (golang-security also for user input).
