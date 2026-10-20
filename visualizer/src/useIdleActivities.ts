import { useEffect, useRef, useState } from "react"
import { SUBAGENTS } from "./agents"
import type { AgentState } from "./office"
import { SLOTS } from "./spots"

const TICK_MS = 3000
const LEAVE_CHANCE = 0.03 // per tick: ~100s average stay
const JOIN_CHANCE = 0.12 // per tick for each empty slot
// Keep most of the team in their rooms: at most ~40% away at once.
const MAX_AWAY = Math.max(2, Math.round(SUBAGENTS.length * 0.4))
const DONE_COOLDOWN_MS = 6000 // let the agent celebrate at its desk first

function isFree(state: AgentState | undefined, now: number) {
  if (!state || state.status === "idle") return true
  return state.status === "done" && now - state.updated > DONE_COOLDOWN_MS
}

const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)]

/**
 * Sends idle subagents to hang-out slots (sofa, coffee bar) and back.
 * Returns slot key → agent id. Busy agents are released right away.
 */
export function useIdleActivities(agents: Record<string, AgentState>): Record<string, string> {
  const agentsRef = useRef(agents)
  agentsRef.current = agents

  const [assigned, setAssigned] = useState<Record<string, string>>(() => {
    const now = Date.now()
    const pool = SUBAGENTS.map((a) => a.id).filter((id) => isFree(agents[id], now))
    const initial: Record<string, string> = {}
    const slots = [...SLOTS].sort(() => Math.random() - 0.5)
    for (const slot of slots.slice(0, MAX_AWAY)) {
      if (pool.length === 0) break
      initial[slot.key] = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]
    }
    return initial
  })

  useEffect(() => {
    const id = setInterval(() => {
      setAssigned((prev) => {
        const now = Date.now()
        const next: Record<string, string> = {}
        for (const [slot, agent] of Object.entries(prev)) {
          if (isFree(agentsRef.current[agent], now) && Math.random() > LEAVE_CHANCE) next[slot] = agent
        }
        const taken = new Set(Object.values(next))
        for (const slot of SLOTS) {
          if (taken.size >= MAX_AWAY) break
          if (next[slot.key] || Math.random() > JOIN_CHANCE) continue
          const free = SUBAGENTS.map((a) => a.id).filter((a) => !taken.has(a) && isFree(agentsRef.current[a], now))
          if (free.length === 0) break
          const agent = pick(free)
          next[slot.key] = agent
          taken.add(agent)
        }
        return next
      })
    }, TICK_MS)
    return () => clearInterval(id)
  }, [])

  // Release busy agents immediately instead of waiting for the next tick.
  const now = Date.now()
  return Object.fromEntries(Object.entries(assigned).filter(([, agent]) => isFree(agents[agent], now)))
}
