/** [x, z] on the floor. */
export type V2 = [number, number]

export type SpotPose =
  | "desk" // resolved from the agent's status (typing, cheer, slump, idle)
  | "gaming"
  | "sip-sit"
  | "chat"
  | "barista"
  | "talk"
  | "home"

/**
 * A place a character can be. Characters walk: back out along the approach of the spot
 * they're leaving → along the corridor → in along the target's approach → seat.
 * `approach[0]` must lie on a corridor (x = CORRIDOR_X or RIGHT_CORRIDOR_X) or on the hallway
 * (z = HALL_Z) that runs between the room rows and links both corridors.
 */
export type Spot = {
  key: string
  approach: V2[]
  seat: V2
  facing: number
  pose: SpotPose
  lift?: number // seat height above a desk chair (bar stools)
}

export const CORRIDOR_X = -3.2
export const RIGHT_CORRIDOR_X = 11.8
export const HALL_Z = -0.2
export const CROSS_LANES = [HALL_Z]

/** Rotation that makes a character (forward = -z) face direction (dx, dz). */
export const face = (dx: number, dz: number) => Math.atan2(-dx, -dz)

export type Activity = "ps5" | "coffee" | "barista" | "chat"

export const ACTIVITY_LABEL: Record<Activity, { label: string; emoji: string }> = {
  ps5: { label: "Main PS5", emoji: "🎮" },
  coffee: { label: "Ngopi", emoji: "☕" },
  barista: { label: "Jadi barista", emoji: "☕" },
  chat: { label: "Ngobrol di bar", emoji: "💬" },
}

export type Slot = Spot & { activity: Activity }

const sofaSeat = (i: number, z: number): Slot => ({
  key: `ps5-${i}`,
  activity: "ps5",
  approach: [[CORRIDOR_X, 2.4], [-7.8, 2.4], [-7.8, z]],
  seat: [-8.45, z],
  facing: face(1, 0),
  pose: "gaming",
})

const stool = (i: number, z: number): Slot => ({
  key: `stool-${i}`,
  activity: "coffee",
  approach: [[CORRIDOR_X, 0], [-7.9, 0], [-7.9, z]],
  seat: [-8.55, z],
  facing: face(-1, 0),
  pose: "sip-sit",
  lift: 0.26,
})

/** Places idle agents can hang out. */
export const SLOTS: Slot[] = [
  sofaSeat(1, 3.7),
  sofaSeat(2, 4.4),
  sofaSeat(3, 5.1),
  stool(1, -3.0),
  stool(2, -2.0),
  stool(3, -1.0),
  {
    key: "barista",
    activity: "barista",
    approach: [[CORRIDOR_X, 0], [-10.15, 0]],
    seat: [-10.15, -2.0],
    facing: face(1, 0),
    pose: "barista",
  },
  { key: "chat-1", activity: "chat", approach: [[CORRIDOR_X, 0], [-6.4, 0]], seat: [-6.4, -1.6], facing: face(0, -1), pose: "chat" },
  { key: "chat-2", activity: "chat", approach: [[CORRIDOR_X, -3.4], [-6.4, -3.4]], seat: [-6.4, -2.8], facing: face(0, 1), pose: "chat" },
]

export const SLOT_BY_KEY = new Map(SLOTS.map((s) => [s.key, s]))

// ---------------------------------------------------------------------------
// Musholla (right side of the office). Kiblat faces the back wall (-z).

export const MUSHOLLA = { minX: 12.4, maxX: 18, minZ: -8, maxZ: -1.3, partitionX: 12.3 }
const MUSHOLLA_LANE = HALL_Z
const IMAM_X = 15.2
const SAF_ROWS = [-5.8, -4.7, -3.6, -2.5]
// Filled from the middle of each row outwards.
const SAF_COLUMNS = [14.8, 15.6, 14.0, 16.4, 13.2, 17.2]

const toward = (qiblaFacing: boolean) => (qiblaFacing ? face(0, -1) : face(0, 1))

export function imamSpot(khutbah: boolean): Spot {
  return {
    key: "imam",
    approach: [[RIGHT_CORRIDOR_X, MUSHOLLA_LANE], [IMAM_X, MUSHOLLA_LANE], [IMAM_X, -7.0]],
    seat: [IMAM_X, -7.0],
    facing: toward(!khutbah),
    pose: "talk",
  }
}

/** Makmum places, front row first. Walkers use the gap beside their place to avoid walking through others. */
export const SAF_SPOTS: Spot[] = SAF_ROWS.flatMap((z, row) =>
  SAF_COLUMNS.map((x): Spot => {
    const gap = x + (x < IMAM_X ? -0.4 : 0.4)
    return {
      key: `saf-${row}-${x}`,
      approach: [[RIGHT_CORRIDOR_X, MUSHOLLA_LANE], [gap, MUSHOLLA_LANE], [gap, z]],
      seat: [x, z],
      facing: toward(true),
      pose: "talk",
    }
  }),
)

const ROW_ORDER = { male: [0, 1, 2, 3], female: [2, 3, 1, 0] } as const

/** Saf places in the order a gender fills them: men in front, women behind. */
export function safSpotsFor(gender: "male" | "female"): Spot[] {
  const perRow = SAF_COLUMNS.length
  return ROW_ORDER[gender].flatMap((row) => SAF_SPOTS.slice(row * perRow, (row + 1) * perRow))
}
