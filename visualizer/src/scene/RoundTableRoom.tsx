import { Html } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import type { MeshStandardMaterial } from "three"
import { AGENT_BY_ID, CATEGORY_STYLE } from "../agents"
import type { AgentState } from "../office"
import { chairsOf, doorPoint, roomCenter, seatRadius, type RoomDef } from "../rooms"
import { face, type V2 } from "../spots"
import { PendantLamp } from "./Lamp"
import { Plant } from "./Room"

const DOOR_WIDTH = 1.4
const WALL_H = 1.0
const GLASS_H = 0.9

/** Low wooden partition with a glass band on top, from a to b. */
function Partition({ a, b }: { a: V2; b: V2 }) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (length < 0.05) return null
  const angle = -Math.atan2(b[1] - a[1], b[0] - a[0])
  const cx = (a[0] + b[0]) / 2
  const cz = (a[1] + b[1]) / 2
  return (
    <group position={[cx, 0, cz]} rotation={[0, angle, 0]}>
      <mesh position={[0, WALL_H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[length, WALL_H, 0.1]} />
        <meshStandardMaterial color="#5c4636" roughness={0.8} />
      </mesh>
      <mesh position={[0, WALL_H + 0.03, 0]}>
        <boxGeometry args={[length, 0.06, 0.16]} />
        <meshStandardMaterial color="#8a6a4f" />
      </mesh>
      <mesh position={[0, WALL_H + GLASS_H / 2 + 0.06, 0]}>
        <boxGeometry args={[length, GLASS_H, 0.03]} />
        <meshStandardMaterial color="#a9c7e8" transparent opacity={0.12} roughness={0.1} />
      </mesh>
      <mesh position={[0, WALL_H + GLASS_H + 0.09, 0]}>
        <boxGeometry args={[length, 0.05, 0.08]} />
        <meshStandardMaterial color="#8a6a4f" />
      </mesh>
    </group>
  )
}

/** Wall segments around the room, leaving the door gap; the building's back wall closes back-row rooms. */
function walls(room: RoomDef): [V2, V2][] {
  const { minX, maxX, minZ, maxZ } = room
  const [dx, dz] = doorPoint(room)
  const half = DOOR_WIDTH / 2
  const doorWall: [V2, V2][] = [
    [[minX, dz], [dx - half, dz]],
    [[dx + half, dz], [maxX, dz]],
  ]
  const sides: [V2, V2][] = [
    [[minX, minZ], [minX, maxZ]],
    [[maxX, minZ], [maxX, maxZ]],
  ]
  const back = dz === maxZ ? [] : ([[[minX, maxZ], [maxX, maxZ]]] as [V2, V2][])
  return [...doorWall, ...sides, ...back]
}

function Chair({ position, facing }: { position: V2; facing: number }) {
  return (
    <group position={[position[0], 0, position[1]]} rotation={[0, facing, 0]}>
      <mesh position={[0, 0.46, 0.04]} castShadow>
        <boxGeometry args={[0.46, 0.07, 0.44]} />
        <meshStandardMaterial color="#3a3432" />
      </mesh>
      <mesh position={[0, 0.78, 0.25]} castShadow>
        <boxGeometry args={[0.44, 0.56, 0.06]} />
        <meshStandardMaterial color="#3a3432" />
      </mesh>
      <mesh position={[0, 0.22, 0.04]}>
        <cylinderGeometry args={[0.03, 0.03, 0.42, 8]} />
        <meshStandardMaterial color="#1d1b19" />
      </mesh>
      <mesh position={[0, 0.02, 0.04]}>
        <cylinderGeometry args={[0.22, 0.24, 0.03, 16]} />
        <meshStandardMaterial color="#1d1b19" />
      </mesh>
    </group>
  )
}

function Laptop({ position, facing, status, color }: { position: V2; facing: number; status: AgentState["status"]; color: string }) {
  const screen = useRef<MeshStandardMaterial>(null!)
  const statusRef = useRef(status)
  statusRef.current = status
  useFrame(({ clock }) => {
    const working = statusRef.current === "working"
    screen.current.emissiveIntensity = working ? 1.1 + Math.sin(clock.elapsedTime * 6) * 0.2 : 0.25
  })
  const glow = status === "error" ? "#ef4444" : status === "working" ? color : "#7d8aa6"
  return (
    <group position={[position[0], 0.775, position[1]]} rotation={[0, facing, 0]}>
      <mesh>
        <boxGeometry args={[0.36, 0.02, 0.24]} />
        <meshStandardMaterial color="#c9ccd2" metalness={0.5} roughness={0.35} />
      </mesh>
      <group position={[0, 0.01, -0.12]} rotation={[-0.3, 0, 0]}>
        <mesh position={[0, 0.12, 0]}>
          <boxGeometry args={[0.36, 0.24, 0.015]} />
          <meshStandardMaterial color="#c9ccd2" metalness={0.5} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.12, 0.009]}>
          <planeGeometry args={[0.32, 0.2]} />
          <meshStandardMaterial ref={screen} color="#10131a" emissive={glow} emissiveIntensity={0.25} />
        </mesh>
      </group>
    </group>
  )
}

function Bookshelf({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  const books = useMemo(
    () =>
      Array.from({ length: 4 }, (_, shelf) =>
        Array.from({ length: 7 }, (_, i) => ({
          x: -0.5 + i * 0.16,
          h: 0.22 + ((shelf * 7 + i) * 37 % 10) / 70,
          color: ["#8c3b3b", "#35587a", "#6a7d3a", "#b0823c", "#5b4a7a", "#d8cfbf"][(shelf + i * 5) % 6],
        })),
      ),
    [],
  )
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.95, 0]} castShadow>
        <boxGeometry args={[1.25, 1.9, 0.36]} />
        <meshStandardMaterial color="#4a3526" />
      </mesh>
      {books.map((row, shelf) => (
        <group key={shelf} position={[0, 0.2 + shelf * 0.44, 0.06]}>
          {row.map((b) => (
            <mesh key={b.x} position={[b.x, b.h / 2 + 0.02, 0]}>
              <boxGeometry args={[0.12, b.h, 0.24]} />
              <meshStandardMaterial color={b.color} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

function ServerRack({ position }: { position: [number, number, number] }) {
  const leds = useRef<MeshStandardMaterial[]>([])
  useFrame(({ clock }) => {
    leds.current.forEach((m, i) => (m.emissiveIntensity = Math.sin(clock.elapsedTime * (3 + i) + i) > 0 ? 2.5 : 0.3))
  })
  return (
    <group position={position}>
      <mesh position={[0, 0.8, 0]} castShadow>
        <boxGeometry args={[0.6, 1.6, 0.6]} />
        <meshStandardMaterial color="#1f2230" />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={i} position={[0.12, 0.3 + i * 0.22, -0.305]}>
          <boxGeometry args={[0.05, 0.03, 0.01]} />
          <meshStandardMaterial ref={(m) => void (m && (leds.current[i] = m))} color="#10b981" emissive="#10b981" emissiveIntensity={1} />
        </mesh>
      ))}
    </group>
  )
}

function FilingCabinet({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[0.5, 1.1, 0.6]} />
        <meshStandardMaterial color="#6f7480" metalness={0.3} />
      </mesh>
      {[0.25, 0.6, 0.95].map((y) => (
        <mesh key={y} position={[0, y, -0.305]}>
          <boxGeometry args={[0.16, 0.03, 0.02]} />
          <meshStandardMaterial color="#d8dbe2" />
        </mesh>
      ))}
    </group>
  )
}

function RoomProps({ room }: { room: RoomDef }) {
  const { minX, maxX, minZ, maxZ } = room
  switch (room.id) {
    case "innovation":
      return <Plant position={[minX + 0.5, 0, minZ + 0.6]} scale={1.1} />
    case "manager":
      return (
        <>
          <Bookshelf position={[maxX - 0.25, 0, -4.8]} rotation={-Math.PI / 2} />
          <Plant position={[minX + 0.5, 0, minZ + 0.6]} />
        </>
      )
    case "solution":
      return (
        <>
          <ServerRack position={[minX + 0.5, 0, maxZ - 0.5]} />
          <Plant position={[maxX - 0.5, 0, maxZ - 0.5]} scale={1.1} />
        </>
      )
    case "archive":
      return (
        <>
          <Bookshelf position={[maxX - 0.25, 0, 3.0]} rotation={-Math.PI / 2} />
          <Bookshelf position={[maxX - 0.25, 0, 5.4]} rotation={-Math.PI / 2} />
          <FilingCabinet position={[minX + 0.45, 0, maxZ - 0.45]} />
          <FilingCabinet position={[minX + 1.0, 0, maxZ - 0.45]} />
        </>
      )
  }
}

type Props = { room: RoomDef; agents: Record<string, AgentState> }

/** A team room: partitions, rug, round table with chairs in a circle, laptops, pendant lamp and props. */
export function RoundTableRoom({ room, agents }: Props) {
  const c = roomCenter(room)
  const chairs = useMemo(() => chairsOf(room), [room])
  const [dx, dz] = doorPoint(room)
  const ring = room.tableRadius + 1.3

  return (
    <group>
      {walls(room).map(([a, b], i) => (
        <Partition key={i} a={a} b={b} />
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[c[0], 0.012, c[1]]} receiveShadow>
        <circleGeometry args={[ring + 0.35, 48]} />
        <meshStandardMaterial color={room.rug} roughness={0.95} />
      </mesh>
      {/* round table */}
      <group position={[c[0], 0, c[1]]}>
        <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[room.tableRadius, room.tableRadius, 0.06, 40]} />
          <meshStandardMaterial color="#9a6b45" roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.37, 0]}>
          <cylinderGeometry args={[0.08, 0.1, 0.72, 12]} />
          <meshStandardMaterial color="#2b2622" />
        </mesh>
        <mesh position={[0, 0.02, 0]}>
          <cylinderGeometry args={[0.4, 0.45, 0.04, 24]} />
          <meshStandardMaterial color="#2b2622" />
        </mesh>
      </group>
      {chairs.map((chair) => {
        const seat: V2 = [c[0] + (seatRadius(room) + 0.05) * Math.cos(chair.angle), c[1] + (seatRadius(room) + 0.05) * Math.sin(chair.angle)]
        const facing = face(c[0] - seat[0], c[1] - seat[1])
        const agent = chair.member ? AGENT_BY_ID.get(chair.member) : undefined
        const laptop: V2 = [c[0] + (room.tableRadius - 0.26) * Math.cos(chair.angle), c[1] + (room.tableRadius - 0.26) * Math.sin(chair.angle)]
        return (
          <group key={chair.angle}>
            <Chair position={seat} facing={facing} />
            {agent && (
              <Laptop
                position={laptop}
                facing={facing}
                status={agents[agent.id]?.status ?? "idle"}
                color={CATEGORY_STYLE[agent.category].color}
              />
            )}
          </group>
        )
      })}
      <PendantLamp position={[c[0], 0, c[1]]} color={room.lamp} height={2.35} />
      <RoomProps room={room} />
      <Html position={[dx, 2.25, dz]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
        <div className="room-label">
          <span>{room.emoji}</span> {room.label}
        </div>
      </Html>
    </group>
  )
}
