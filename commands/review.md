---
description: Review code or recent changes (reviewer only)
agent: hermes
---

Route: review
Review: <request>$ARGUMENTS</request>

Project detection (first): decide from the paths/names in the request — APP = `seedly_app/` (Flutter; screen, widget, Bloc), CMS = `growpico-cms/` (Next.js admin dashboard; admin page), BE = `growpico-be/` (Go; endpoint, handler, migration, SQL, job). Ambiguous: ask once; several projects: one route per project. Start every delegation with `Project: APP`, `Project: CMS` or `Project: BE`. `growpico-iot/` (firmware) is out of scope.

Route: reviewer only — it finds the files itself. No scout. Skills for the reviewer: APP flutter-client-architecture · CMS cms-nextjs-architecture · BE be-architecture, golang-code-style, golang-error-handling (+ the project's security skill for auth/token/storage code: security-boundaries · cms-security-boundaries · be-security-boundaries + golang-security). Memory: save only a CRITICAL/HIGH issue worth remembering.
