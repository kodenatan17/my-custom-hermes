---
description: Analyze code or a question (scout; +architect for deep/architecture)
agent: hermes
---

Route: analyze
Analyze: <request>$ARGUMENTS</request>

Project detection (first): decide from the paths/names in the request — APP = `seedly_app/` (Flutter; screen, widget, Bloc), CMS = `growpico-cms/` (Next.js admin dashboard; admin page), BE = `growpico-be/` (Go; endpoint, handler, migration, SQL, job). Ambiguous: ask once; several projects: one route per project. Start every delegation with `Project: APP`, `Project: CMS` or `Project: BE`. `growpico-iot/` (firmware) is out of scope.

Route: scout(analyze). Add architect(design) only if the user asks for architecture options or a design.
Skills for the agents: spec-first plus the project's architecture skill (APP flutter-client-architecture · CMS cms-nextjs-architecture · BE be-architecture, + be-api-contract / be-database when endpoints or schema are involved).
Memory: save only if a new decision or gotcha came out of it.
