---
description: Fix a bug: scout(diagnose) → coder(fix) → reviewer
agent: hermes
---

Route: bugfix
Bug: <request>$ARGUMENTS</request>

Route: scout(diagnose — root cause with file:line evidence) → coder(fix, minimal change) → reviewer.
Add qa only if business logic changed. If scout says the cause is server-side, stop and report.
Memory: save the root cause + fix as a known_gotcha when it is non-obvious.
