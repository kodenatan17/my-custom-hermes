---
description: CI/build/release changes: devops → reviewer
agent: hermes
---

Route: devops
DevOps: <request>$ARGUMENTS</request>

Project detection (first): decide from the paths/names in the request — APP = `seedly_app/` (Flutter; screen, widget, Bloc), CMS = `growpico-cms/` (Next.js admin dashboard; admin page), BE = `growpico-be/` (Go; endpoint, handler, migration, SQL, job). Ambiguous: ask once; several projects: one route per project. Start every delegation with `Project: APP`, `Project: CMS` or `Project: BE`. `growpico-iot/` (firmware) is out of scope.

Route: devops → reviewer. BE: build/deploy config only (Go build, Dockerfile, Render settings in docs/config files, CI) — never change production infrastructure or apply migrations.

Lean handoff (applies to every delegation of this route): give each agent only what it needs — the goal in one line, `Project:`, exact file paths with line ranges when known, the earlier step's findings (not its whole output), and the skills to load by name (none if not needed). Do not ask an agent to explore beyond its step, to "also check" other areas, or to add abstractions, options, tests or docs the request did not ask for. Each agent works within its own tool budget and stops with PARTIAL rather than sprawling; a reviewer's non-blocking SUGGESTIONS are reported to the user, not sent back to the coder.
