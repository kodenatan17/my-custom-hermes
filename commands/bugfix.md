---
description: Fix a bug: scout(diagnose) → coder(fix) → reviewer
agent: hermes
---

Route: bugfix
Bug: <request>$ARGUMENTS</request>

Project detection (first): decide from the paths/names in the request — APP = `seedly_app/` (Flutter; screen, widget, Bloc), CMS = `growpico-cms/` (Next.js admin dashboard; admin page), BE = `growpico-be/` (Go; endpoint, handler, migration, SQL, job). Ambiguous: ask once; several projects: one route per project. Start every delegation with `Project: APP`, `Project: CMS` or `Project: BE`. `growpico-iot/` (firmware) is out of scope.

Route: scout(diagnose — root cause with file:line evidence) → coder(fix, minimal change) → reviewer.
Add qa only if business logic changed. If scout says the cause is in another project (e.g. server-side for an APP bug), stop and report which project — the user decides whether to fix it there.
Skills for the agents:
APP tasks (seedly_app/, Flutter): spec-first, plus flutter-client-architecture / api-contract-conventions / security-boundaries only if the task touches them.
CMS tasks (growpico-cms/, Next.js): spec-first, cms-nextjs-architecture, plus cms-ui-slicing / cms-api-contract / cms-security-boundaries only if the task touches them.
BE tasks (growpico-be/, Go): spec-first, be-architecture, golang-code-style, golang-error-handling, golang-design-patterns, plus be-api-contract / be-database / be-security-boundaries + golang-security only if the task touches endpoints, schema/SQL or auth (golang-security also for user input).
Memory: save the root cause + fix as a known_gotcha when it is non-obvious.
