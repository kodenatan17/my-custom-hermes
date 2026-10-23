---
description: Memory statistics and compaction candidates (read-only)
agent: hermes
---

Route: memory-status
Request: <request>$ARGUMENTS</request>

Answer directly with the Knowledge Graph tools — no dispatch, no writes.

Read the graph (`read_graph`, or `search_nodes` with the query `[project:`), then report:

1. **Totals** — entities and relations.
2. **Provenance by scope** — count entities whose observations contain a `[project:<scope>]` marker:
   `growpico` · `rt-rw` · `shared` · `pasconnect` · `gts` · `unclassified` ·
   **untagged** (no `[project:` marker at all) · **unknown scope** (marker present, value outside this list).
3. **GrowPico area distribution** — from the same provenance observation: `area:app`, `area:be`, `area:iot`,
   plus combinations such as `area:app,be`. Count per area and list any `[project:growpico]` entity without an
   `area:` marker.
4. **Compaction** — flag when 5 or more `session_learning` entities carry `[project:growpico]`.

Rules:

- Only `[project:growpico]` counts as GrowPico. Never count `shared`, `rt-rw`, `pasconnect`, `gts` or
  `unclassified` entities as GrowPico.
- `area:` and `[project:…]` are convention metadata inside an observation string, not a first-class field and
  not an access-control boundary: `search_nodes` matches them as text only, `open_nodes` cannot filter by them.
  Say this plainly whenever the request implies per-area or per-project isolation.
- Untagged legacy entities and unknown-scope markers must be listed by name, not silently ignored.
- Read-only: no create, add, or delete. For deletion routes (`memory`, `compact`, `forget`) require explicit
  user confirmation first.
