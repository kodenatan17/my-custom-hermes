import { homedir } from "node:os"
import { formatRecall, MemoryIndex } from "./lib/memory-score"

/**
 * Memory recall: attaches relevant Hermes knowledge-graph entries (Arsa's domain) to
 * the current turn for whichever agent is a flow's entry point. The lookup is plain
 * code over knowledge.json — no model tool call, no extra agent hop.
 *
 * Only orchestrator and documenter are entry points (every command either routes
 * through orchestrator, or goes straight to documenter for /comment and /document —
 * see .opencode/commands/*.md). Agents orchestrator delegates to via Task (scout,
 * architect, coder, qa, reviewer, devops) get relevant entries through its HANDOFF
 * instead; recalling again there would just re-spend the same lookup for nothing new.
 * memory-manager is excluded too — it IS the graph, it doesn't need a summary of itself.
 *
 * The block is injected (via the v2 session "context" hook) as an extra user message right
 * after the user message it was recalled for, never into the system prompt: system content
 * is shared by the whole session and changing it every turn breaks prompt caching for
 * everything after it. The hook runs on every step of the agent loop, so the block is
 * computed once per user message id and re-inserted at the same position each time to keep
 * the prompt prefix stable. It is not persisted; the next recall pass never sees it because
 * injected messages have no id.
 *
 * If a command template wraps the user's actual request in <request>...</request>,
 * only that inner text is used for matching — the surrounding routing instructions
 * (agent names, "Route:", etc.) would otherwise pollute the keyword match.
 *
 * MEMORY_RECALL_FILE overrides the graph path. MEMORY_RECALL=off disables it.
 */

const FILE = process.env.MEMORY_RECALL_FILE ?? `${homedir()}/.hermes/profiles/rtdigital/memories/mcp/knowledge.json`
const RECALL_AGENTS = new Set(["orchestrator", "documenter"])
const REQUEST_TAG = /<request>([\s\S]*?)<\/request>/

type TextPart = { type: string; text?: string }
type Message = { id?: string; role: string; content: TextPart[] }

const textOf = (m: Message) =>
  m.content
    .map((p) => (p.type === "text" ? (p.text ?? "") : ""))
    .join(" ")
    .trim()

export default {
  id: "memory-recall",
  setup: async (api: any) => {
    if (process.env.MEMORY_RECALL === "off") return
    const index = new MemoryIndex(FILE)
    // user message id -> recall block ("" = nothing relevant)
    const recalled = new Map<string, string>()

    await api.session.hook("context", (input: { agent?: string; messages: Message[] }) => {
      if (!input.agent || !RECALL_AGENTS.has(input.agent)) return
      const { messages } = input

      // Walk back to front so splicing never shifts indexes still to be visited.
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m.role !== "user" || !m.id) continue
        let block = recalled.get(m.id)
        if (block === undefined) {
          // Only the newest user message is looked up; older ones without a cached block stay as they were.
          if (i !== lastUserIndex(messages)) continue
          const text = textOf(m)
          block = text && index.refresh() ? formatRecall(index.search(REQUEST_TAG.exec(text)?.[1] ?? text)) : ""
          recalled.set(m.id, block)
        }
        if (block) messages.splice(i + 1, 0, { role: "user", content: [{ type: "text", text: block }] })
      }
    })
  },
}

function lastUserIndex(messages: Message[]) {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user" && messages[i].id) return i
  return -1
}
