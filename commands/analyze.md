---
description: Analyze code or a question (scout; +architect for deep/architecture)
agent: hermes
---

Route: analyze
Analyze: <request>$ARGUMENTS</request>

Route: scout(analyze). Add architect(design) only if the user asks for architecture options or a design.
Memory: save only if a new decision or gotcha came out of it.
