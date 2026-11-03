---
description: Selectively reset memory by category (asks before deleting)
agent: hermes
---

Route: forget
Category: <request>$ARGUMENTS</request>

Answer directly with the Knowledge Graph tools — no dispatch.
Category is one of: session | feature | patterns | gotchas | all. Only entities tagged `[project:growpico]`.
List what would be deleted and PAUSE for confirmation before deleting anything. Never delete module_decision or user_preference.
