import { ORCHESTRATOR_ID, SUBAGENTS } from "./agents"
import { face, HALL_Z, type Spot, type V2 } from "./spots"

export type RoomId = "manager" | "solution" | "innovation" | "archive"

export type RoomDef = {
  id: RoomId
  label: string
  emoji: string
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  tableRadius: number
  rug: string
  lamp: string
}

/** Back-row rooms open onto the hallway at maxZ, front-row rooms at minZ. */
export const ROOMS: RoomDef[] = [
  { id: "innovation", label: "Innovation", emoji: "💡", minX: -2.5, maxX: 4.5, minZ: -8, maxZ: -1.2, tableRadius: 0.8, rug: "#3d5a80", lamp: "#ffd59a" },
  { id: "manager", label: "Manager", emoji: "🧭", minX: 5, maxX: 11, minZ: -8, maxZ: -1.2, tableRadius: 0.8, rug: "#6b3f4a", lamp: "#ffc98a" },
  { id: "solution", label: "Solution", emoji: "🛠️", minX: -2.5, maxX: 4.5, minZ: 0.8, maxZ: 7.8, tableRadius: 1.1, rug: "#2f5d50", lamp: "#ffd08f" },
  { id: "archive", label: "Archieve", emoji: "📚", minX: 5, maxX: 11, minZ: 0.8, maxZ: 7.8, tableRadius: 0.8, rug: "#6a5230", lamp: "#ffcf94" },
]

const ROOM_OF: Record<string, RoomId> = {
  [ORCHESTRATOR_ID]: "manager",
  qa: "solution",
  coder: "solution",
  reviewer: "solution",
  devops: "solution",
  scout: "innovation",
  architect: "innovation",
  documenter: "archive",
  "memory-manager": "archive",
}

/** Agents without a mapping join the Solution room. */
export const roomOf = (agentId: string): RoomDef => ROOMS.find((r) => r.id === (ROOM_OF[agentId] ?? "solution"))!

export const roomCenter = (r: RoomDef): V2 => [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2]
const isBackRow = (r: RoomDef) => r.maxZ <= HALL_Z
/** Direction from the table toward the door, as an angle in the x/z plane. */
const doorAngle = (r: RoomDef) => (isBackRow(r) ? Math.PI / 2 : -Math.PI / 2)
export const doorPoint = (r: RoomDef): V2 => [roomCenter(r)[0], isBackRow(r) ? r.maxZ : r.minZ]

const SEAT_GAP = 0.55 // table edge → seat
const RING_GAP = 1.3 // table edge → walking ring (clears seated people)
const polar = (c: V2, radius: number, angle: number): V2 => [c[0] + radius * Math.cos(angle), c[1] + radius * Math.sin(angle)]

export const membersOf = (room: RoomDef) =>
  [ORCHESTRATOR_ID, ...SUBAGENTS.map((a) => a.id)].filter((id) => roomOf(id).id === room.id)

export type Chair = { angle: number; member?: string }

/** Chairs around the table (at least 4), with members spread out: 1 → far side, 2 → opposite, 4 → all. */
export function chairsOf(room: RoomDef): Chair[] {
  const members = membersOf(room)
  const count = Math.max(4, members.length)
  const base = doorAngle(room) + Math.PI / count
  const chairs: Chair[] = Array.from({ length: count }, (_, i) => ({ angle: base + (i * 2 * Math.PI) / count }))
  const order = count === 4 ? (members.length === 1 ? [1] : members.length === 2 ? [1, 3] : [1, 2, 3, 0]) : chairs.map((_, i) => i)
  members.forEach((id, i) => (chairs[order[i]].member = id))
  return chairs
}

export const seatRadius = (r: RoomDef) => r.tableRadius + SEAT_GAP

/** Waypoints hallway → door → around the table's octagon ring to the point nearest `angle`. */
function approachTo(room: RoomDef, angle: number): V2[] {
  const c = roomCenter(room)
  const [dx, dz] = doorPoint(room)
  const inside: V2 = [dx, dz + (isBackRow(room) ? -0.7 : 0.7)]
  const ring = room.tableRadius + RING_GAP
  const start = doorAngle(room)
  const step = Math.PI / 4
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
  const steps = Math.round(wrap(angle - start) / step)
  const path: V2[] = [[dx, HALL_Z], inside]
  for (let k = 0; Math.abs(k) <= Math.abs(steps); k += Math.sign(steps) || 1) {
    path.push(polar(c, ring, start + k * step))
    if (steps === 0) break
  }
  return path
}

export function seatSpot(agentId: string): Spot {
  const room = roomOf(agentId)
  const chair = chairsOf(room).find((ch) => ch.member === agentId)!
  const c = roomCenter(room)
  const seat = polar(c, seatRadius(room), chair.angle)
  return {
    key: `seat:${agentId}`,
    approach: approachTo(room, chair.angle),
    seat,
    facing: face(c[0] - seat[0], c[1] - seat[1]),
    pose: "desk",
  }
}

/** Where the orchestrator stands when briefing an agent: just beside its chair, facing it. */
export function visitSpot(agentId: string): Spot {
  const room = roomOf(agentId)
  const chair = chairsOf(room).find((ch) => ch.member === agentId)!
  const c = roomCenter(room)
  const angle = chair.angle + 0.5
  const stand = polar(c, seatRadius(room) + 0.35, angle)
  const target = polar(c, seatRadius(room), chair.angle)
  return {
    key: `visit:${agentId}`,
    approach: approachTo(room, angle),
    seat: stand,
    facing: face(target[0] - stand[0], target[1] - stand[1]),
    pose: "talk",
  }
}
