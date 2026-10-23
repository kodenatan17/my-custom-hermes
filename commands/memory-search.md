---
description: Search memory for a topic (read-only)
agent: hermes
---

Route: memory-search
Topic: <request>$ARGUMENTS</request>

Answer directly with the Knowledge Graph tools — no dispatch, no writes.
`search_nodes` once per single keyword of the topic (never a phrase), then `open_nodes` on the hits.
Reply `<entity> (<type>): <first observation>` per hit, or `no memory found`.
