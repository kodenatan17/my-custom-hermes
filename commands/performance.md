---
description: Performance work: scout → coder → reviewer
agent: hermes
---

Route: performance
Performance: <request>$ARGUMENTS</request>

Project detection (first): decide from the paths/names in the request — APP = `seedly_app/` (Flutter; screen, widget, Bloc), CMS = `growpico-cms/` (Next.js admin dashboard; admin page), BE = `growpico-be/` (Go; endpoint, handler, migration, SQL, job). Ambiguous: ask once; several projects: one route per project. Start every delegation with `Project: APP`, `Project: CMS` or `Project: BE`. `growpico-iot/` (firmware) is out of scope.

Route: scout(analyze — where the cost is, with evidence) → coder(performance) → reviewer.
Skills for the agents: spec-first plus the project's architecture skill (APP flutter-client-architecture · CMS cms-nextjs-architecture · BE be-architecture). BE also golang-performance (+ be-database when queries or schema are involved); measure with benchmarks/pprof or query plans before and after.

Lean handoff (applies to every delegation of this route): give each agent only what it needs — the goal in one line, `Project:`, exact file paths with line ranges when known, the earlier step's findings (not its whole output), and the skills to load by name (none if not needed). Do not ask an agent to explore beyond its step, to "also check" other areas, or to add abstractions, options, tests or docs the request did not ask for. Each agent works within its own tool budget and stops with PARTIAL rather than sprawling; a reviewer's non-blocking SUGGESTIONS are reported to the user, not sent back to the coder.
