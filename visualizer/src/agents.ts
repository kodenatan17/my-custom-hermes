// Roster = .opencode/agents/<name>.md files with `mode: subagent` in their frontmatter.
const agentFiles = import.meta.glob<string>("../../agents/*.md", { query: "?raw", import: "default", eager: true })

export type Category =
  | "orchestrator"
  | "research"
  | "planning"
  | "solutioning"
  | "implementation"
  | "quality"
  | "documentation"
  | "infrastructure"
  | "memory"
  | "other"

export const CATEGORY_STYLE: Record<Category, { label: string; color: string }> = {
  orchestrator: { label: "Orkestrator", color: "#7c4dcc" },
  research: { label: "Research", color: "#2f5fd0" },
  planning: { label: "Planning", color: "#0f8b8d" },
  solutioning: { label: "Solutioning", color: "#c2410c" },
  implementation: { label: "Developer", color: "#1f8a4c" },
  quality: { label: "QA", color: "#d9731a" },
  documentation: { label: "Docs", color: "#b8488a" },
  infrastructure: { label: "Infra", color: "#4b5563" },
  memory: { label: "Memori", color: "#8a6d1f" },
  other: { label: "Agent", color: "#64748b" },
}


export type Agent = {
  id: string
  name: string
  role: string
  gender: "male" | "female"
  description: string
  category: Category
}

export const ORCHESTRATOR_ID = "orchestrator"

// Primary agents that all map to the standing orchestrator character.
const ORCHESTRATOR_ALIASES = new Set(["orchestrator", "orchestrator-agent", "general", "build", "plan"])

// Category per agent (drives desk color/grouping). Unknown agents fall back to "other".
const CATEGORY_BY_AGENT: Record<string, Category> = {
  scout: "research",
  architect: "planning",
  coder: "implementation",
  qa: "quality",
  reviewer: "quality",
  documenter: "documentation",
  devops: "infrastructure",
  "memory-manager": "memory",
}

function frontmatter(source: string): Record<string, string> {
  const block = source.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ""
  return Object.fromEntries(
    block
      .split("\n")
      .map((line) => line.match(/^([a-z_]+):\s*(.+)$/))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .map((m) => [m[1], m[2].trim()]),
  )
}

const CATEGORY_ORDER: Category[] = [
  "research",
  "planning",
  "solutioning",
  "implementation",
  "quality",
  "documentation",
  "infrastructure",
  "memory",
  "other",
]

const capitalize = (id: string) => id.charAt(0).toUpperCase() + id.slice(1)

const definitions = Object.entries(agentFiles).map(([path, source]) => {
  const id = path.match(/([^/]+)\.md$/)![1]
  // Name and role come from the "# <Nama> - <Peran>" heading in the agent file.
  const [, name, role] = source.match(/^# (.+?) - (.+)$/m) ?? []
  const gender = source.match(/<!-- gender: (male|female) -->/)?.[1] === "female" ? "female" : "male"
  return { id, meta: frontmatter(source), name: name ?? capitalize(id), role: role ?? "", gender } as const
})

export const SUBAGENTS: Agent[] = definitions
  .filter(({ meta }) => meta.mode === "subagent")
  .map(({ id, meta, name, role, gender }) => ({
    id,
    name,
    gender,
    role: role || CATEGORY_STYLE[CATEGORY_BY_AGENT[id] ?? "other"].label,
    description: meta.description ?? "",
    category: CATEGORY_BY_AGENT[id] ?? "other",
  }))
  .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))

const orchestratorFile = definitions.find((d) => d.id === ORCHESTRATOR_ID)

export const ORCHESTRATOR: Agent = {
  id: ORCHESTRATOR_ID,
  name: orchestratorFile?.name ?? "Orchestrator",
  role: orchestratorFile?.role || CATEGORY_STYLE.orchestrator.label,
  gender: orchestratorFile?.gender ?? "male",
  description: orchestratorFile?.meta.description ?? "Workflow coordinator",
  category: "orchestrator",
}

export const ALL_AGENTS = [ORCHESTRATOR, ...SUBAGENTS]
export const AGENT_BY_ID = new Map(ALL_AGENTS.map((a) => [a.id, a]))

/** Maps a raw opencode agent name to a roster id, or null when it can't be placed. */
export function normalizeAgent(raw: string | undefined): string | null {
  if (!raw || raw === "subagent") return null
  if (ORCHESTRATOR_ALIASES.has(raw)) return ORCHESTRATOR_ID
  return raw
}


/** "<Nama> - <Peran>" */
export const displayName = (agent: Agent | undefined, fallback: string) => (agent ? `${agent.name} - ${agent.role}` : fallback)
