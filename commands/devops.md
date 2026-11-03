---
description: CI/build/release changes: devops → reviewer
agent: hermes
---

Route: devops
DevOps: <request>$ARGUMENTS</request>

Project detection (first): decide from the paths/names in the request — APP = `seedly_app/` (Flutter; screen, widget, Bloc), CMS = `growpico-cms/` (Next.js admin dashboard; admin page), BE = `growpico-be/` (Go; endpoint, handler, migration, SQL, job). Ambiguous: ask once; several projects: one route per project. Start every delegation with `Project: APP`, `Project: CMS` or `Project: BE`. `growpico-iot/` (firmware) is out of scope.

Route: devops → reviewer. BE: build/deploy config only (Go build, Dockerfile, Render settings in docs/config files, CI) — never change production infrastructure or apply migrations.
