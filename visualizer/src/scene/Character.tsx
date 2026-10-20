import { useFrame } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import type { Group, Mesh } from "three"
import type { PrayerPose } from "../prayer"

export type Pose =
  // seated
  | "sit"
  | "typing"
  | "cheer"
  | "slump"
  | "desk-idle" // cycles through sit / phone / stretch
  | "gaming"
  | "sip-sit"
  // standing
  | "stand"
  | "walking"
  | "talk"
  | "chat"
  | "barista"
  // sholat
  | PrayerPose

type Resolved = Exclude<Pose, "desk-idle"> | "phone" | "stretch"

type Legs = "stand" | "chair" | "kneel-sit" | "kneel-up"

const LEGS: Partial<Record<Resolved, Legs>> = {
  sit: "chair",
  typing: "chair",
  cheer: "chair",
  slump: "chair",
  gaming: "chair",
  "sip-sit": "chair",
  phone: "chair",
  stretch: "chair",
  duduk: "kneel-sit",
  "salam-r": "kneel-sit",
  "salam-l": "kneel-sit",
  doa: "kneel-sit",
  sujud: "kneel-up",
}

// thigh angle, knee angle, body drop
const LEG_SHAPE: Record<Exclude<Legs, "stand">, [number, number, number]> = {
  chair: [Math.PI / 2, -Math.PI / 2, -0.28],
  "kneel-sit": [1.05, -Math.PI / 2 - 1.05, -0.55],
  "kneel-up": [0.2, -Math.PI / 2 - 0.2, -0.37],
}

const DESK_IDLE_CYCLE: Resolved[] = ["sit", "phone", "sit", "stretch"]

type Props = {
  shirt: string
  pose: () => Pose
  gender?: "male" | "female"
  /** Wear sholat attire: gamis for men, mukena for women. */
  praying?: boolean
  skin?: string
  hair?: string
  pants?: string
}

const HAIR_COLORS = ["#2b2118", "#4a3222", "#1c1c24", "#6b4a2b", "#3a2a1f"]
const SKIN_COLORS = ["#f1c7a3", "#e0ac84", "#c68a62", "#f5d3b8", "#a86f4c"]

const HIP_Y = 0.8

/** Sholat attire, layered over the everyday outfit: gamis (male) and mukena (female). */
const ATTIRE = {
  male: { color: "#e9e3d4", torso: [0.215, 0.24, 0.62], sleeve: 0.075, thigh: 0.098, shin: 0.09 },
  female: { color: "#f8f4fb", torso: [0.22, 0.31, 0.7], sleeve: 0.088, thigh: 0.115, shin: 0.105 },
} as const

type Target = {
  thigh: [number, number]
  knee: [number, number]
  drop: number
  bend: number
  armL: [number, number]
  armR: [number, number]
  head: [number, number]
  yaw: number
}

/** Low-poly person built from primitives, animated procedurally with smoothed transitions. */
export function Character({ shirt, pose, gender = "male", praying = false, skin, hair, pants = "#3b4252" }: Props) {
  const body = useRef<Group>(null!)
  const upper = useRef<Group>(null!)
  const head = useRef<Group>(null!)
  const armL = useRef<Group>(null!)
  const armR = useRef<Group>(null!)
  const legL = useRef<Group>(null!)
  const legR = useRef<Group>(null!)
  const kneeL = useRef<Group>(null!)
  const kneeR = useRef<Group>(null!)
  const cup = useRef<Mesh>(null!)
  const phone = useRef<Mesh>(null!)
  const pad = useRef<Mesh>(null!)
  const drop = useRef(0)

  const look = useMemo(() => {
    const seed = Math.random()
    return {
      phase: seed * 20,
      skin: skin ?? SKIN_COLORS[Math.floor(seed * SKIN_COLORS.length)],
      hair: hair ?? HAIR_COLORS[Math.floor(((seed * 7) % 1) * HAIR_COLORS.length)],
      ponytail: ((seed * 13) % 1) < 0.5,
    }
  }, [skin, hair])

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime + look.phase
    let p = pose() as Resolved | "desk-idle"
    if (p === "desk-idle") p = DESK_IDLE_CYCLE[Math.floor(t / 7) % DESK_IDLE_CYCLE.length]

    const legs = LEGS[p] ?? "stand"
    const target: Target = {
      thigh: [0, 0],
      knee: [0, 0],
      drop: 0,
      bend: 0,
      armL: [0.05, 0.1],
      armR: [0.05, -0.1],
      head: [0, 0],
      yaw: 0,
    }
    let bob = Math.sin(t * 2) * 0.01

    if (legs === "stand") {
      const swing = p === "walking" ? Math.sin(t * 9) * 0.6 : 0
      target.thigh = [swing, -swing]
      target.knee = [-Math.max(0, -swing) * 0.9, -Math.max(0, swing) * 0.9]
    } else {
      const [thigh, knee, d] = LEG_SHAPE[legs]
      target.thigh = [thigh, thigh]
      target.knee = [knee, knee]
      target.drop = d
    }

    switch (p) {
      case "typing":
        target.armL = [1.25 + Math.sin(t * 18) * 0.2, 0.08]
        target.armR = [1.25 + Math.sin(t * 18 + Math.PI) * 0.2, -0.08]
        target.head = [0.14 + Math.sin(t * 3) * 0.04, Math.sin(t * 1.3) * 0.12]
        break
      case "sit":
        target.armL = [0.55, 0.08]
        target.armR = [0.55, -0.08]
        target.head = [Math.sin(t * 0.8) * 0.05, Math.sin(t * 0.4) * 0.2]
        break
      case "cheer":
        target.armL = [Math.PI - 0.2, 0.35 + Math.sin(t * 10) * 0.15]
        target.armR = [Math.PI - 0.2, -0.35 - Math.sin(t * 10) * 0.15]
        break
      case "slump":
        target.armL = [0.2, 0.08]
        target.armR = [0.2, -0.08]
        target.head = [0.35, 0]
        break
      case "phone":
        target.armL = [0.5, 0.08]
        target.armR = [1.35, -0.45]
        target.head = [0.4, 0]
        break
      case "stretch":
        target.armL = [Math.PI - 0.3 + Math.sin(t * 1.5) * 0.15, 0.25]
        target.armR = [Math.PI - 0.3 + Math.sin(t * 1.5) * 0.15, -0.25]
        target.head = [-0.2, 0]
        break
      case "gaming": {
        const hype = t % 6 < 0.8 // occasional hype burst
        const lift = hype ? 0.5 + Math.sin(t * 20) * 0.1 : 0
        target.armL = [0.95 + lift + Math.sin(t * 14) * 0.04, 0.25]
        target.armR = [0.95 + lift + Math.sin(t * 14 + 1) * 0.04, -0.25]
        target.head = [0.08, Math.sin(t * 0.7) * 0.06]
        bob = hype ? Math.abs(Math.sin(t * 20)) * 0.03 : Math.sin(t * 3) * 0.008
        break
      }
      case "sip-sit":
      case "chat": {
        const sipping = t % 6 < 1.6
        target.armR = sipping ? [2.2, -0.5] : [0.9, -0.25]
        target.armL = p === "chat" && !sipping ? [0.4 + Math.sin(t * 2.3) * 0.35, 0.15] : [p === "sip-sit" ? 0.5 : 0.05, 0.1]
        target.head = [sipping ? -0.15 : 0, sipping ? 0 : Math.sin(t * 0.9) * 0.3]
        break
      }
      case "barista":
        target.armL = [1.0 + Math.sin(t * 3) * 0.25, 0.1]
        target.armR = [1.0 + Math.sin(t * 3 + 2) * 0.25, -0.1]
        target.head = [0.25, 0]
        target.yaw = Math.sin(t * 0.5) * 0.5
        break
      case "talk":
        target.armL = [0.1, 0.1]
        target.armR = [0.9 + Math.sin(t * 4) * 0.25, -0.15]
        target.head = [0, Math.sin(t * 2) * 0.15]
        break
      case "walking": {
        const swing = Math.sin(t * 9) * 0.6
        target.armL = [-swing * 0.8, 0.1]
        target.armR = [swing * 0.8, -0.1]
        bob = Math.abs(Math.sin(t * 9)) * 0.05
        break
      }
      // sholat
      case "takbir":
        target.armL = [2.65, 0.2]
        target.armR = [2.65, -0.2]
        bob = 0
        break
      case "qiyam":
        target.armL = [0.95, 0.6]
        target.armR = [0.95, -0.6]
        target.head = [0.2, 0]
        bob = 0
        break
      case "ruku":
        target.bend = -Math.PI / 2
        target.armL = [Math.PI / 2, 0.05]
        target.armR = [Math.PI / 2, -0.05]
        bob = 0
        break
      case "sujud":
        target.bend = -2.0
        target.armL = [3.0, 0.15]
        target.armR = [3.0, -0.15]
        bob = 0
        break
      case "duduk":
        target.armL = [0.7, 0.1]
        target.armR = [0.7, -0.1]
        target.head = [0.15, 0]
        bob = 0
        break
      case "salam-r":
      case "salam-l":
        target.armL = [0.7, 0.1]
        target.armR = [0.7, -0.1]
        target.head = [0.05, p === "salam-r" ? -1.0 : 1.0]
        bob = 0
        break
      case "doa":
        target.armL = [1.35, 0.3]
        target.armR = [1.35, -0.3]
        target.head = [0.3, 0]
        bob = 0
        break
    }

    // Fast-moving loops (typing, walking) follow tightly; pose changes ease in.
    const k = 1 - Math.exp(-dt * (p === "walking" || p === "typing" || p === "gaming" ? 30 : 9))
    const ease = (from: number, to: number) => from + (to - from) * k
    legL.current.rotation.x = ease(legL.current.rotation.x, target.thigh[0])
    legR.current.rotation.x = ease(legR.current.rotation.x, target.thigh[1])
    kneeL.current.rotation.x = ease(kneeL.current.rotation.x, target.knee[0])
    kneeR.current.rotation.x = ease(kneeR.current.rotation.x, target.knee[1])
    upper.current.rotation.x = ease(upper.current.rotation.x, target.bend)
    armL.current.rotation.x = ease(armL.current.rotation.x, target.armL[0])
    armL.current.rotation.z = ease(armL.current.rotation.z, target.armL[1])
    armR.current.rotation.x = ease(armR.current.rotation.x, target.armR[0])
    armR.current.rotation.z = ease(armR.current.rotation.z, target.armR[1])
    head.current.rotation.x = ease(head.current.rotation.x, target.head[0])
    head.current.rotation.y = ease(head.current.rotation.y, target.head[1])
    body.current.rotation.y = ease(body.current.rotation.y, target.yaw)
    drop.current = ease(drop.current, target.drop)
    body.current.position.y = drop.current + bob

    cup.current.visible = p === "sip-sit" || p === "chat"
    phone.current.visible = p === "phone"
    pad.current.visible = p === "gaming"
  })

  const attire = ATTIRE[gender]
  const hooded = praying && gender === "female"

  return (
    <group ref={body}>
      {/* legs: thigh from the hip, shin from the knee */}
      {[
        [legL, kneeL, -0.09],
        [legR, kneeR, 0.09],
      ].map(([leg, knee, x], i) => (
        <group key={i} ref={leg as React.RefObject<Group>} position={[x as number, HIP_Y, 0]}>
          <mesh position={[0, -0.18, 0]} castShadow>
            <capsuleGeometry args={[0.075, 0.2, 4, 8]} />
            <meshStandardMaterial color={pants} />
          </mesh>
          {praying && (
            <mesh position={[0, -0.18, 0]} castShadow>
              <capsuleGeometry args={[attire.thigh, 0.2, 4, 8]} />
              <meshStandardMaterial color={attire.color} />
            </mesh>
          )}
          <group ref={knee as React.RefObject<Group>} position={[0, -0.36, 0]}>
            <mesh position={[0, -0.2, 0]} castShadow>
              <capsuleGeometry args={[0.07, 0.26, 4, 8]} />
              <meshStandardMaterial color={pants} />
            </mesh>
            {praying && (
              <mesh position={[0, -0.2, 0]} castShadow>
                <capsuleGeometry args={[attire.shin, 0.26, 4, 8]} />
                <meshStandardMaterial color={attire.color} />
              </mesh>
            )}
          </group>
        </group>
      ))}
      {/* everything above the hips bends as one (ruku, sujud) */}
      <group ref={upper} position={[0, HIP_Y, 0]}>
        <mesh position={[0, 0.27, 0]} castShadow>
          <capsuleGeometry args={[0.19, 0.26, 4, 12]} />
          <meshStandardMaterial color={shirt} />
        </mesh>
        {praying && (
          <>
            {/* gamis / mukena body: hangs from the shoulders past the hips */}
            <mesh position={[0, 0.15, 0]} castShadow>
              <cylinderGeometry args={[attire.torso[0], attire.torso[1], attire.torso[2], 16]} />
              <meshStandardMaterial color={attire.color} />
            </mesh>
            {gender === "female" && (
              <mesh position={[0, 0.5, 0]} scale={[1, 0.55, 1]} castShadow>
                <sphereGeometry args={[0.26, 16, 10]} />
                <meshStandardMaterial color={attire.color} />
              </mesh>
            )}
          </>
        )}
        <group ref={armL} position={[-0.26, 0.45, 0]}>
          <mesh position={[0, -0.17, 0]} castShadow>
            <capsuleGeometry args={[0.06, 0.26, 4, 8]} />
            <meshStandardMaterial color={shirt} />
          </mesh>
          {praying && (
            <mesh position={[0, -0.16, 0]} castShadow>
              <capsuleGeometry args={[attire.sleeve, 0.24, 4, 8]} />
              <meshStandardMaterial color={attire.color} />
            </mesh>
          )}
          <mesh position={[0, -0.36, 0]}>
            <sphereGeometry args={[0.06, 8, 8]} />
            <meshStandardMaterial color={look.skin} />
          </mesh>
        </group>
        <group ref={armR} position={[0.26, 0.45, 0]}>
          <mesh position={[0, -0.17, 0]} castShadow>
            <capsuleGeometry args={[0.06, 0.26, 4, 8]} />
            <meshStandardMaterial color={shirt} />
          </mesh>
          {praying && (
            <mesh position={[0, -0.16, 0]} castShadow>
              <capsuleGeometry args={[attire.sleeve, 0.24, 4, 8]} />
              <meshStandardMaterial color={attire.color} />
            </mesh>
          )}
          <mesh position={[0, -0.36, 0]}>
            <sphereGeometry args={[0.06, 8, 8]} />
            <meshStandardMaterial color={look.skin} />
          </mesh>
          {/* props held in the right hand */}
          <mesh ref={cup} position={[-0.02, -0.42, -0.04]} visible={false}>
            <cylinderGeometry args={[0.045, 0.038, 0.1, 12]} />
            <meshStandardMaterial color="#fdfbf7" />
          </mesh>
          <mesh ref={phone} position={[-0.02, -0.41, -0.03]} visible={false}>
            <boxGeometry args={[0.08, 0.14, 0.015]} />
            <meshStandardMaterial color="#111318" emissive="#5aa9ff" emissiveIntensity={0.3} />
          </mesh>
          <mesh ref={pad} position={[-0.16, -0.39, -0.03]} visible={false}>
            <boxGeometry args={[0.24, 0.045, 0.11]} />
            <meshStandardMaterial color="#f4f5f7" />
          </mesh>
        </group>
        <group ref={head} position={[0, 0.62, 0]}>
          <mesh position={[0, 0.08, 0]} castShadow>
            <sphereGeometry args={[0.16, 16, 12]} />
            <meshStandardMaterial color={look.skin} />
          </mesh>
          {hooded ? (
            // telekung: sits behind the face so the face shows through as an opening
            <mesh position={[0, 0.08, 0.05]} scale={[1, 1.05, 1]} castShadow>
              <sphereGeometry args={[0.185, 16, 12]} />
              <meshStandardMaterial color={attire.color} />
            </mesh>
          ) : (
            <mesh position={[0, 0.13, 0.02]} scale={[1.06, 0.8, 1.06]}>
              <sphereGeometry args={[0.165, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color={look.hair} />
            </mesh>
          )}
          {gender === "female" && !hooded &&
            (look.ponytail ? (
              <group>
                <mesh position={[0, 0.2, 0.13]}>
                  <sphereGeometry args={[0.075, 12, 10]} />
                  <meshStandardMaterial color={look.hair} />
                </mesh>
                <mesh position={[0, 0.02, 0.2]} rotation={[0.35, 0, 0]}>
                  <capsuleGeometry args={[0.055, 0.2, 4, 8]} />
                  <meshStandardMaterial color={look.hair} />
                </mesh>
              </group>
            ) : (
              <mesh position={[0, -0.02, 0.07]} scale={[1.05, 1, 0.75]}>
                <capsuleGeometry args={[0.16, 0.2, 4, 12]} />
                <meshStandardMaterial color={look.hair} />
              </mesh>
            ))}
          {[-0.055, 0.055].map((x) => (
            <mesh key={x} position={[x, 0.08, -0.148]}>
              <sphereGeometry args={[0.022, 8, 6]} />
              <meshStandardMaterial color="#1d1d22" />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  )
}
