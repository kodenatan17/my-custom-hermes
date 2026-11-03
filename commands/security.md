---
description: Security audit (reviewer in security mode)
agent: hermes
---

Route: security
Security audit: <request>$ARGUMENTS</request>

Project detection (first): decide from the paths/names in the request — APP = `seedly_app/` (Flutter; screen, widget, Bloc), CMS = `growpico-cms/` (Next.js admin dashboard; admin page), BE = `growpico-be/` (Go; endpoint, handler, migration, SQL, job). Ambiguous: ask once; several projects: one route per project. Start every delegation with `Project: APP`, `Project: CMS` or `Project: BE`. `growpico-iot/` (firmware) is out of scope.

Route: reviewer(security mode). Only if the user asked for fixes: coder(fix) → reviewer. Skills for the agents: APP security-boundaries · CMS cms-security-boundaries · BE be-security-boundaries + golang-security.
