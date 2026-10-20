import { readFileSync, statSync } from "node:fs"

export type Entity = { name: string; entityType: string; observations: string[] }

type Indexed = Entity & { nameTokens: Set<string>; bodyTokens: Set<string> }

// English + Indonesian filler and generic request words that carry no topic.
const STOPWORDS = new Set(
  `the and for with that this from into onto are was were been have has had not but you your our can could should would will
  please make add update create change fix use using used need want also only just then than when what which where who how why
  all any each other some such more most very new old get set run app apps code file files task tasks work agent agents
  yang dan atau di ke dari untuk dengan ini itu apa bisa tolong aku gua gue saya kamu dong kan juga jadi agar supaya tidak
  ada akan sudah belum masih harus buat bikin tambah tambahin ubah cek check coba mau lagi hanya saja kalau apakah karena
  seedly flutter`.split(/\s+/),
)

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t))
}

const MIN_SCORE = 8
const RELATIVE_CUTOFF = 0.3

const TYPE_WEIGHT: Record<string, number> = { known_gotcha: 1.3, module_decision: 1.15, flutter_pattern: 1.1 }

export class MemoryIndex {
  private entities: Indexed[] = []
  private df = new Map<string, number>()
  private mtime = 0

  constructor(private file: string) {}

  /** Reloads the JSONL knowledge graph when the file changed. Returns false if unreadable. */
  refresh(): boolean {
    let mtime: number
    try {
      mtime = statSync(this.file).mtimeMs
    } catch {
      return false
    }
    if (mtime === this.mtime) return true
    const entities: Indexed[] = []
    for (const line of readFileSync(this.file, "utf8").split("\n")) {
      if (!line.trim()) continue
      try {
        const row = JSON.parse(line)
        if (row.type !== "entity" || !row.name) continue
        const observations: string[] = Array.isArray(row.observations) ? row.observations : []
        entities.push({
          name: row.name,
          entityType: row.entityType ?? "",
          observations,
          nameTokens: new Set(tokenize(row.name)),
          bodyTokens: new Set(tokenize(`${row.entityType} ${observations.join(" ")}`)),
        })
      } catch {
        // skip malformed line
      }
    }
    const df = new Map<string, number>()
    for (const e of entities) for (const t of new Set([...e.nameTokens, ...e.bodyTokens])) df.set(t, (df.get(t) ?? 0) + 1)
    this.entities = entities
    this.df = df
    this.mtime = mtime
    return true
  }

  /** Top entities for a prompt, ranked by IDF-weighted keyword overlap (name hits count triple). */
  search(prompt: string, limit = 5): { entity: Entity; score: number; matched: string[] }[] {
    const query = [...new Set(tokenize(prompt))]
    if (query.length === 0) return []
    const n = this.entities.length
    const results = []
    for (const e of this.entities) {
      let score = 0
      const matched: string[] = []
      for (const q of query) {
        const inName = e.nameTokens.has(q)
        const inBody = inName || e.bodyTokens.has(q) || (q.length >= 5 && [...e.bodyTokens].some((t) => t.startsWith(q)))
        if (!inBody) continue
        const idf = Math.log(1 + n / (this.df.get(q) ?? 1))
        score += idf * (inName ? 3 : 1)
        matched.push(q)
      }
      // One incidental word is noise: require a name hit or two distinct matched keywords.
      if (matched.length < 2 && !matched.some((q) => e.nameTokens.has(q))) continue
      score *= TYPE_WEIGHT[e.entityType] ?? 1
      results.push({ entity: e, score, matched })
    }
    results.sort((a, b) => b.score - a.score)
    // Drop weak tails: absolute floor, and anything far below the best hit.
    const cutoff = Math.max(MIN_SCORE, (results[0]?.score ?? 0) * RELATIVE_CUTOFF)
    return results.filter((r) => r.score >= cutoff).slice(0, limit)
  }
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s)

/**
 * Compact block attached to the triggering turn (~1.5k tokens max). The top hit gets
 * its full observation list (it's the one most likely to fully answer the request);
 * the rest get a 2-observation summary just enough to judge relevance.
 */
export function formatRecall(hits: { entity: Entity }[], maxChars = 6000): string {
  const header = [
    "<memory-context>",
    "Hermes knowledge graph (Arsa / memory-manager's domain) — not something the user said.",
    "If an entry below answers the request, answer from it and skip delegation; say it came from memory. Re-verify only if it looks stale or conflicts with current code.",
  ]
  const lines: string[] = []
  let size = header.join("\n").length
  hits.forEach(({ entity }, i) => {
    const limit = i === 0 ? entity.observations.length : 2
    const charCap = i === 0 ? 400 : 240
    const obs = entity.observations.slice(0, limit).map((o) => clip(o, charCap)).join(" | ")
    const line = `- [${entity.entityType}] ${entity.name}: ${obs}`
    if (size + line.length > maxChars) return
    lines.push(line)
    size += line.length
  })
  return lines.length === 0 ? "" : [...header, ...lines, "</memory-context>"].join("\n")
}
