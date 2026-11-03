---
description: Refactor without behavior change: scout → coder → reviewer
agent: hermes
---

Route: refactor
Refactor: <request>$ARGUMENTS</request>

Project detection (first): decide from the paths/names in the request — APP = `seedly_app/` (Flutter; screen, widget, Bloc), CMS = `growpico-cms/` (Next.js admin dashboard; admin page), BE = `growpico-be/` (Go; endpoint, handler, migration, SQL, job). Ambiguous: ask once; several projects: one route per project. Start every delegation with `Project: APP`, `Project: CMS` or `Project: BE`. `growpico-iot/` (firmware) is out of scope.

Route: scout(find) → coder(refactor) → reviewer. Large refactor (several features or shared core): scout(analyze) first and add qa at the end.
Skills for the agents:
APP tasks (seedly_app/, Flutter): spec-first, plus flutter-client-architecture / api-contract-conventions / security-boundaries only if the task touches them.
CMS tasks (growpico-cms/, Next.js): spec-first, cms-nextjs-architecture, plus cms-ui-slicing / cms-api-contract / cms-security-boundaries only if the task touches them.
BE tasks (growpico-be/, Go): spec-first, be-architecture, golang-code-style, golang-error-handling, golang-design-patterns, plus be-api-contract / be-database / be-security-boundaries + golang-security only if the task touches endpoints, schema/SQL or auth (golang-security also for user input).

Lean handoff (applies to every delegation of this route): give each agent only what it needs — the goal in one line, `Project:`, exact file paths with line ranges when known, the earlier step's findings (not its whole output), and the skills to load by name (none if not needed). Do not ask an agent to explore beyond its step, to "also check" other areas, or to add abstractions, options, tests or docs the request did not ask for. Each agent works within its own tool budget and stops with PARTIAL rather than sprawling; a reviewer's non-blocking SUGGESTIONS are reported to the user, not sent back to the coder.
