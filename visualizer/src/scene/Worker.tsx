import { Html } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useLayoutEffect, useRef } from "react"
import type { Group } from "three"
import { CATEGORY_STYLE, type Agent } from "../agents"
import type { AgentState } from "../office"
import { CROSS_LANES, type Spot, type V2 } from "../spots"
import { Character, type Pose } from "./Character"

const SPEED = 2.6

type Step = { to: V2; kind: "out" | "link" | "in" | "seat" }

type Props = {
  agent: Agent
  state?: AgentState
  spot: Spot
  /** Pose while settled at the spot. */
  pose: () => Pose
  badge?: string
  /** Hide the name label unless focused (e.g. while praying). */
  quiet?: boolean
  focused: boolean
  onSelect: (id: string) => void
}

const wrapAngle = (a: number) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI
const near = (a: number, b: number) => Math.abs(a - b) < 0.05

/**
 * Waypoints between two route anchors, each on a corridor (vertical, fixed x) or on a
 * cross lane (horizontal, fixed z). Anchors on the same line connect directly.
 */
function linkCorridors(from: V2, to: V2): V2[] {
  const laneOf = (p: V2) => CROSS_LANES.find((z) => near(z, p[1]))
  const fromLane = laneOf(from)
  const toLane = laneOf(to)
  if (fromLane !== undefined && fromLane === toLane) return [] // along the same lane
  if (near(from[0], to[0])) return [] // along the same corridor
  if (fromLane !== undefined) return [[to[0], fromLane]] // lane → corridor
  if (toLane !== undefined) return [[from[0], toLane]] // corridor → lane
  const lane = CROSS_LANES.reduce((best, z) =>
    Math.abs(from[1] - z) + Math.abs(z - to[1]) < Math.abs(from[1] - best) + Math.abs(best - to[1]) ? z : best,
  )
  return [[from[0], lane], [to[0], lane]]
}

/** A character that walks between spots via the corridor, then settles into the spot's pose. */
export function Worker({ agent, state, spot, pose, badge, quiet, focused, onSelect }: Props) {
  const group = useRef<Group>(null!)
  const nav = useRef({ key: spot.key, trail: [...spot.approach], queue: [] as Step[], moving: false })
  const spotRef = useRef(spot)
  spotRef.current = spot
  const poseRef = useRef(pose)
  poseRef.current = pose

  const status = state?.status ?? "idle"
  const style = CATEGORY_STYLE[agent.category]

  useLayoutEffect(() => {
    group.current.position.set(spot.seat[0], spot.lift ?? 0, spot.seat[1])
    group.current.rotation.y = spot.facing
    // Only on mount; later spot changes are walked to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame((_, rawDt) => {
    const n = nav.current
    const s = spotRef.current
    const g = group.current
    const dt = Math.min(rawDt, 0.25)

    if (n.key !== s.key) {
      // Retrace to the corridor, then walk in to the new spot.
      n.key = s.key
      const exit: V2 = n.trail[0] ?? [g.position.x, g.position.z]
      n.queue = [
        ...[...n.trail].reverse().map((to): Step => ({ to, kind: "out" })),
        ...linkCorridors(exit, s.approach[0]).map((to): Step => ({ to, kind: "link" })),
        ...s.approach.map((to): Step => ({ to, kind: "in" })),
        { to: s.seat, kind: "seat" },
      ]
    }

    const step = n.queue[0]
    if (step) {
      n.moving = true
      g.position.y += (0 - g.position.y) * 0.3
      const dx = step.to[0] - g.position.x
      const dz = step.to[1] - g.position.z
      const dist = Math.hypot(dx, dz)
      const move = SPEED * dt
      if (dist <= move) {
        g.position.x = step.to[0]
        g.position.z = step.to[1]
        n.queue.shift()
        if (step.kind === "out") n.trail.pop()
        else if (step.kind === "in") n.trail.push(step.to)
      } else {
        g.position.x += (dx / dist) * move
        g.position.z += (dz / dist) * move
        g.rotation.y += wrapAngle(Math.atan2(-dx, -dz) - g.rotation.y) * 0.25
      }
    } else {
      n.moving = false
      g.rotation.y += wrapAngle(s.facing - g.rotation.y) * 0.15
      g.position.y += ((s.lift ?? 0) - g.position.y) * 0.2
    }
  })

  const currentPose = (): Pose => (nav.current.moving ? "walking" : poseRef.current())

  return (
    <group ref={group} onClick={(e) => (e.stopPropagation(), onSelect(agent.id))}>
      {/* `quiet` is only set while the agent is taking part in the congregational prayer */}
      <Character shirt={style.color} pose={currentPose} gender={agent.gender} praying={quiet} />
      <Html position={[0, 2.25, 0]} center zIndexRange={[focused || status === "working" ? 60 : 10, 0]} style={{ pointerEvents: "none" }}>
        <div className="scene-label-stack">
          {status === "working" && state?.activity && (
            <div className="bubble">
              {agent.category === "orchestrator" ? <b>{state.activity}</b> : <>Menjalankan: <b>{state.activity}</b></>}
            </div>
          )}
          {status === "error" && <div className="bubble bubble-error">{state?.activity ?? "Error"}</div>}
          {(!quiet || focused) && <div className={`pill ${status}${focused ? " focused" : ""}${badge ? " away" : ""}`} style={{ background: style.color }}>
            {status === "done" && <span className="pill-check">✓</span>}
            {badge && <span className="pill-badge">{badge}</span>}
            <b>{agent.name}</b>
            <span className="pill-role"> - {agent.role}</span>
          </div>}
        </div>
      </Html>
    </group>
  )
}
