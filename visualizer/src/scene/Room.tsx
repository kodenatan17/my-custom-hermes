import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import { CanvasTexture, Color, RepeatWrapping, SRGBColorSpace, type Group, type MeshStandardMaterial, type PointLight } from "three"
import type { PrayerView } from "../usePrayer"
import { countdown } from "../prayer"
import { MUSHOLLA } from "../spots"
import { FloorLamp, PendantLamp } from "./Lamp"

export const ROOM = { minX: -11, maxX: 18, minZ: -8, maxZ: 8, wallH: 3.4 }

function useFloorTexture() {
  return useMemo(() => {
    const c = Object.assign(document.createElement("canvas"), { width: 512, height: 512 })
    const ctx = c.getContext("2d")!
    const tones = ["#c9a47c", "#c19c74", "#cfab84", "#b9936b"]
    for (let row = 0; row < 8; row++) {
      let x = -((row * 97) % 180)
      while (x < 512) {
        const w = 160 + ((row * 31 + x) % 90)
        ctx.fillStyle = tones[(row + Math.abs(Math.floor(x / 60))) % tones.length]
        ctx.fillRect(x, row * 64, w, 64)
        ctx.strokeStyle = "rgba(150,120,80,0.18)"
        ctx.strokeRect(x, row * 64, w, 64)
        x += w
      }
    }
    const t = new CanvasTexture(c)
    t.wrapS = t.wrapT = RepeatWrapping
    t.repeat.set(7.5, 4)
    t.colorSpace = SRGBColorSpace
    return t
  }, [])
}

export function Plant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.17, 0.5, 12]} />
        <meshStandardMaterial color="#f4f1ea" />
      </mesh>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <mesh key={i} position={[Math.cos(i) * 0.1, 0.75, Math.sin(i) * 0.1]} rotation={[Math.cos(i * 2) * 0.5, i, Math.sin(i * 2) * 0.5]} castShadow>
          <coneGeometry args={[0.09, 0.8, 5]} />
          <meshStandardMaterial color={i % 2 ? "#5f9b4f" : "#7bb661"} />
        </mesh>
      ))}
    </group>
  )
}

function Lounge({ gaming }: { gaming: number }) {
  const screen = useRef<MeshStandardMaterial>(null!)
  const glow = useRef<PointLight>(null!)
  const tint = useMemo(() => new Color(), [])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (gaming > 0) {
      tint.setHSL((t * 0.08) % 1, 0.7, 0.55)
      screen.current.emissive.copy(tint)
      screen.current.emissiveIntensity = 0.9 + Math.sin(t * 7) * 0.15
      glow.current.color.copy(tint)
      glow.current.intensity = 2.2 + Math.sin(t * 5) * 0.6
    } else {
      screen.current.emissive.set("#5b3aa0")
      screen.current.emissiveIntensity = 0.2
      glow.current.intensity = 0
    }
  })
  return (
    <group position={[-7.4, 0, 4.2]}>
      {/* rug */}
      <mesh position={[0.4, 0.01, 0.2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[4.6, 3.4]} />
        <meshStandardMaterial color="#f1ece2" />
      </mesh>
      {/* sofa, facing +x toward the TV */}
      <group position={[-1.2, 0, 0.2]}>
        <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
          <boxGeometry args={[1, 0.4, 2.6]} />
          <meshStandardMaterial color="#8fbfaa" />
        </mesh>
        <mesh position={[-0.4, 0.7, 0]} castShadow>
          <boxGeometry args={[0.25, 0.8, 2.6]} />
          <meshStandardMaterial color="#86b7a1" />
        </mesh>
        {[-1.3, 1.3].map((z) => (
          <mesh key={z} position={[0, 0.55, z]} castShadow>
            <boxGeometry args={[1, 0.5, 0.2]} />
            <meshStandardMaterial color="#86b7a1" />
          </mesh>
        ))}
        <mesh position={[-0.1, 0.72, 0.6]} rotation={[0, 0, -0.3]}>
          <boxGeometry args={[0.15, 0.4, 0.4]} />
          <meshStandardMaterial color="#e8c35a" />
        </mesh>
      </group>
      {/* coffee table */}
      <group position={[0.3, 0, 0.2]}>
        <mesh position={[0, 0.4, 0]} castShadow>
          <boxGeometry args={[0.8, 0.06, 1.2]} />
          <meshStandardMaterial color="#b98b5e" />
        </mesh>
        {[[-0.35, -0.55], [0.35, -0.55], [-0.35, 0.55], [0.35, 0.55]].map(([x, z]) => (
          <mesh key={`${x}${z}`} position={[x, 0.2, z]}>
            <boxGeometry args={[0.04, 0.4, 0.04]} />
            <meshStandardMaterial color="#2f3137" />
          </mesh>
        ))}
        <mesh position={[0, 0.48, -0.2]}>
          <cylinderGeometry args={[0.06, 0.05, 0.1, 12]} />
          <meshStandardMaterial color="#fafafa" />
        </mesh>
        <mesh position={[0.1, 0.44, 0.25]}>
          <boxGeometry args={[0.3, 0.02, 0.22]} />
          <meshStandardMaterial color="#f59e0b" />
        </mesh>
      </group>
      {/* TV on stand, facing the sofa */}
      <group position={[2.3, 0, 0.2]} rotation={[0, -Math.PI / 2, 0]}>
        <mesh position={[0, 0.25, 0]} castShadow>
          <boxGeometry args={[2, 0.5, 0.5]} />
          <meshStandardMaterial color="#b07a4f" />
        </mesh>
        <mesh position={[0, 1.15, 0]} castShadow>
          <boxGeometry args={[1.8, 1.05, 0.06]} />
          <meshStandardMaterial color="#1c1d22" />
        </mesh>
        <mesh position={[0, 1.15, 0.035]}>
          <planeGeometry args={[1.7, 0.95]} />
          <meshStandardMaterial ref={screen} color="#261b3a" emissive="#5b3aa0" emissiveIntensity={0.2} />
        </mesh>
        {/* PS5 standing on the TV stand */}
        <group position={[0.78, 0.72, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.12, 0.44, 0.34]} />
            <meshStandardMaterial color="#f7f7f9" />
          </mesh>
          <mesh>
            <boxGeometry args={[0.07, 0.4, 0.35]} />
            <meshStandardMaterial color="#15161a" />
          </mesh>
          <mesh position={[0, -0.235, 0]}>
            <boxGeometry args={[0.2, 0.03, 0.2]} />
            <meshStandardMaterial color="#15161a" />
          </mesh>
          <mesh position={[0, 0.1, 0.176]}>
            <boxGeometry args={[0.02, 0.02, 0.005]} />
            <meshStandardMaterial color="#3b82f6" emissive="#3b82f6" emissiveIntensity={gaming > 0 ? 2 : 0.3} />
          </mesh>
        </group>
        <pointLight ref={glow} position={[0, 1.2, 0.8]} distance={5} decay={1.5} intensity={0} />
      </group>
      <Plant position={[-1.4, 0, -1.7]} scale={1.2} />
    </group>
  )
}

function useNightSkyTexture() {
  return useMemo(() => {
    const c = Object.assign(document.createElement("canvas"), { width: 512, height: 280 })
    const ctx = c.getContext("2d")!
    const sky = ctx.createLinearGradient(0, 0, 0, 280)
    sky.addColorStop(0, "#0b1030")
    sky.addColorStop(1, "#27335e")
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, 512, 280)
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.35 + ((i * 53) % 10) / 16})`
      ctx.fillRect((i * 97) % 512, (i * 41) % 150, 2, 2)
    }
    ctx.fillStyle = "#f6f0d8"
    ctx.beginPath()
    ctx.arc(410, 55, 26, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = "#27335e"
    ctx.beginPath()
    ctx.arc(398, 48, 24, 0, Math.PI * 2)
    ctx.fill()
    for (let b = 0; b < 11; b++) {
      const x = b * 48 - 8
      const h = 70 + ((b * 67) % 9) * 16
      ctx.fillStyle = b % 2 ? "#141a33" : "#1a2140"
      ctx.fillRect(x, 280 - h, 44, h)
      for (let wy = 280 - h + 10; wy < 270; wy += 16) {
        for (let wx = x + 6; wx < x + 40; wx += 10) {
          if ((wx * 7 + wy * 3 + b) % 5 < 2) {
            ctx.fillStyle = (wx + wy) % 3 ? "#ffd27a" : "#ffe9b0"
            ctx.fillRect(wx, wy, 5, 7)
          }
        }
      }
    }
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    return t
  }, [])
}

/** Window with the city at night. */
function NightWindow({ x, width = 3.4 }: { x: number; width?: number }) {
  const sky = useNightSkyTexture()
  return (
    <group position={[x, 1.85, ROOM.minZ + 0.11]}>
      <mesh>
        <boxGeometry args={[width + 0.2, 2.1, 0.08]} />
        <meshStandardMaterial color="#5c4636" />
      </mesh>
      <mesh position={[0, 0, 0.045]}>
        <planeGeometry args={[width, 1.9]} />
        <meshStandardMaterial map={sky} emissive="#ffffff" emissiveMap={sky} emissiveIntensity={0.9} />
      </mesh>
      <mesh position={[0, 0, 0.06]}>
        <boxGeometry args={[0.06, 1.9, 0.02]} />
        <meshStandardMaterial color="#5c4636" />
      </mesh>
    </group>
  )
}

/** Warm fairy lights draped along a wall between two points (y = hook height). */
function StringLights({ from, to, y = 3.05, sag = 0.25, count = 26 }: { from: [number, number]; to: [number, number]; y?: number; sag?: number; count?: number }) {
  const bulbs = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const t = i / (count - 1)
        return {
          pos: [from[0] + (to[0] - from[0]) * t, y - Math.sin(t * Math.PI * 3) ** 2 * sag, from[1] + (to[1] - from[1]) * t] as [number, number, number],
          color: ["#ffd27a", "#ffb86b", "#fff1c1"][i % 3],
        }
      }),
    [from, to, y, sag, count],
  )
  return (
    <group>
      {bulbs.map((b, i) => (
        <mesh key={i} position={b.pos}>
          <sphereGeometry args={[0.035, 8, 6]} />
          <meshStandardMaterial color={b.color} emissive={b.color} emissiveIntensity={3} />
        </mesh>
      ))}
    </group>
  )
}

function CorkBoard() {
  return (
    <group position={[ROOM.minX + 0.11, 1.9, -4.8]} rotation={[0, Math.PI / 2, 0]}>
      <mesh>
        <boxGeometry args={[2.2, 1.5, 0.06]} />
        <meshStandardMaterial color="#b7895a" />
      </mesh>
      <mesh position={[0, 0, 0.035]}>
        <planeGeometry args={[2.0, 1.3]} />
        <meshStandardMaterial color="#d8b07e" />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={i} position={[-0.72 + (i % 4) * 0.48, 0.28 - Math.floor(i / 4) * 0.55, 0.04]} rotation={[0, 0, ((i * 13) % 7) / 50 - 0.06]}>
          <planeGeometry args={[0.38, 0.42]} />
          <meshStandardMaterial color={["#fff7d6", "#ffffff", "#e8f3ff", "#fff0e6"][i % 4]} />
        </mesh>
      ))}
    </group>
  )
}

function useSignTexture(text: string) {
  return useMemo(() => {
    const c = Object.assign(document.createElement("canvas"), { width: 512, height: 160 })
    const ctx = c.getContext("2d")!
    ctx.fillStyle = "#3b2a20"
    ctx.beginPath()
    ctx.roundRect(0, 0, 512, 160, 28)
    ctx.fill()
    ctx.fillStyle = "#f7e7c6"
    ctx.font = "700 76px Inter, sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(text, 256, 84)
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    return t
  }, [text])
}

function Stool({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.74, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.2, 0.06, 16]} />
        <meshStandardMaterial color="#c0843f" />
      </mesh>
      <mesh position={[0, 0.37, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.72, 8]} />
        <meshStandardMaterial color="#2f3137" />
      </mesh>
      <mesh position={[0, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.14, 0.012, 6, 16]} />
        <meshStandardMaterial color="#2f3137" />
      </mesh>
      <mesh position={[0, 0.015, 0]}>
        <cylinderGeometry args={[0.18, 0.2, 0.03, 16]} />
        <meshStandardMaterial color="#2f3137" />
      </mesh>
    </group>
  )
}

/** Coffee counter along the left wall, with stools and a standing table. */
function CoffeeBar() {
  const sign = useSignTexture("KOPI BAR")
  const counterX = -9.3
  const wallX = ROOM.minX + 0.12
  return (
    <group>
      {/* sign + shelves on the wall */}
      <mesh position={[wallX + 0.02, 2.75, -2.0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[1.8, 0.56]} />
        <meshStandardMaterial map={sign} />
      </mesh>
      {[1.55, 2.05].map((y) => (
        <group key={y}>
          <mesh position={[wallX + 0.15, y, -2.0]} castShadow>
            <boxGeometry args={[0.3, 0.05, 2.6]} />
            <meshStandardMaterial color="#b98b5e" />
          </mesh>
          {Array.from({ length: 7 }, (_, i) => (
            <mesh key={i} position={[wallX + 0.15, y + 0.13, -3.1 + i * 0.37]}>
              <cylinderGeometry args={[0.07, 0.07, 0.22, 10]} />
              <meshStandardMaterial color={["#6b4a2b", "#f4f1ea", "#8fbfaa", "#e8c35a"][(i + (y > 2 ? 1 : 0)) % 4]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* counter */}
      <mesh position={[counterX, 0.52, -2.0]} castShadow receiveShadow>
        <boxGeometry args={[0.6, 1.04, 3.0]} />
        <meshStandardMaterial color="#8a5a3b" />
      </mesh>
      <mesh position={[counterX + 0.05, 1.07, -2.0]} castShadow>
        <boxGeometry args={[0.8, 0.06, 3.15]} />
        <meshStandardMaterial color="#f3efe8" />
      </mesh>
      {/* espresso machine */}
      <group position={[counterX - 0.1, 1.1, -3.0]}>
        <mesh position={[0, 0.2, 0]} castShadow>
          <boxGeometry args={[0.42, 0.4, 0.5]} />
          <meshStandardMaterial color="#c9ccd2" metalness={0.6} roughness={0.3} />
        </mesh>
        <mesh position={[0.22, 0.12, 0]}>
          <boxGeometry args={[0.04, 0.08, 0.3]} />
          <meshStandardMaterial color="#2f3137" />
        </mesh>
        <mesh position={[0, 0.43, 0]}>
          <boxGeometry args={[0.44, 0.05, 0.52]} />
          <meshStandardMaterial color="#2f3137" />
        </mesh>
      </group>
      {/* cups + pastry dome */}
      {[-2.3, -2.1, -1.9].map((z) => (
        <mesh key={z} position={[counterX + 0.2, 1.14, z]}>
          <cylinderGeometry args={[0.045, 0.038, 0.09, 12]} />
          <meshStandardMaterial color="#fdfbf7" />
        </mesh>
      ))}
      <group position={[counterX, 1.1, -1.0]}>
        <mesh position={[0, 0.02, 0]}>
          <cylinderGeometry args={[0.24, 0.24, 0.03, 20]} />
          <meshStandardMaterial color="#e5e1d8" />
        </mesh>
        <mesh position={[0, 0.06, 0]}>
          <sphereGeometry args={[0.07, 10, 8]} />
          <meshStandardMaterial color="#d99a4e" />
        </mesh>
        <mesh position={[0, 0.03, 0]}>
          <sphereGeometry args={[0.23, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#dff1ff" transparent opacity={0.35} />
        </mesh>
      </group>
      {[-3.0, -2.0, -1.0].map((z) => (
        <Stool key={z} position={[-8.55, 0, z]} />
      ))}
      {/* standing table */}
      <group position={[-6.4, 0, -2.2]}>
        <mesh position={[0, 1.05, 0]} castShadow>
          <cylinderGeometry args={[0.36, 0.36, 0.05, 20]} />
          <meshStandardMaterial color="#f3efe8" />
        </mesh>
        <mesh position={[0, 0.52, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 1.04, 8]} />
          <meshStandardMaterial color="#2f3137" />
        </mesh>
        <mesh position={[0, 0.015, 0]}>
          <cylinderGeometry args={[0.24, 0.26, 0.03, 16]} />
          <meshStandardMaterial color="#2f3137" />
        </mesh>
      </group>
    </group>
  )
}

const hhmm = (d: Date) => d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false })

/** Analog clock showing the real local time. */
function WallClock({ position }: { position: [number, number, number] }) {
  const hour = useRef<Group>(null!)
  const minute = useRef<Group>(null!)
  const second = useRef<Group>(null!)
  useFrame(() => {
    const d = new Date()
    const s = d.getSeconds() + d.getMilliseconds() / 1000
    const m = d.getMinutes() + s / 60
    const h = (d.getHours() % 12) + m / 60
    second.current.rotation.z = -(s / 60) * Math.PI * 2
    minute.current.rotation.z = -(m / 60) * Math.PI * 2
    hour.current.rotation.z = -(h / 12) * Math.PI * 2
  })
  const hand = (ref: React.RefObject<Group>, length: number, width: number, color: string, z: number) => (
    <group ref={ref} position={[0, 0, z]}>
      <mesh position={[0, length / 2 - 0.04, 0]}>
        <boxGeometry args={[width, length, 0.01]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  )
  return (
    <group position={position}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.42, 0.42, 0.06, 32]} />
        <meshStandardMaterial color="#2f3137" />
      </mesh>
      <mesh position={[0, 0, 0.032]}>
        <circleGeometry args={[0.37, 32]} />
        <meshStandardMaterial color="#fbfaf6" />
      </mesh>
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={i} position={[Math.sin((i / 12) * Math.PI * 2) * 0.31, Math.cos((i / 12) * Math.PI * 2) * 0.31, 0.035]} rotation={[0, 0, -(i / 12) * Math.PI * 2]}>
          <boxGeometry args={[0.02, i % 3 === 0 ? 0.08 : 0.04, 0.005]} />
          <meshStandardMaterial color="#2f3137" />
        </mesh>
      ))}
      {hand(hour, 0.2, 0.035, "#2f3137", 0.04)}
      {hand(minute, 0.3, 0.025, "#2f3137", 0.045)}
      {hand(second, 0.32, 0.01, "#dc2626", 0.05)}
    </group>
  )
}

/** Jadwal sholat board, redrawn every second. */
function ScheduleBoard({ prayer, position }: { prayer: PrayerView; position: [number, number, number] }) {
  const canvas = useMemo(() => Object.assign(document.createElement("canvas"), { width: 512, height: 640 }), [])
  const texture = useMemo(() => {
    const t = new CanvasTexture(canvas)
    t.colorSpace = SRGBColorSpace
    t.anisotropy = 4
    return t
  }, [canvas])

  const { now, schedule, next, session, phase } = prayer
  const second = Math.floor(now / 1000)
  useEffect(() => {
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = "#123b2c"
    ctx.fillRect(0, 0, 512, 640)
    ctx.strokeStyle = "#d4b25c"
    ctx.lineWidth = 6
    ctx.strokeRect(12, 12, 488, 616)
    ctx.textAlign = "center"
    ctx.fillStyle = "#f5e6b8"
    ctx.font = "700 40px Inter, sans-serif"
    ctx.fillText("Jadwal Sholat", 256, 76)
    ctx.fillStyle = "#ffffff"
    ctx.font = "600 64px Inter, sans-serif"
    ctx.fillText(new Date(now).toLocaleTimeString("id-ID", { hour12: false }).replace(/\./g, ":"), 256, 158)

    schedule.forEach((entry, i) => {
      const y = 232 + i * 52
      const isNext = !session && entry.name === next.name && entry.at.getTime() === next.at.getTime()
      const isNow = session?.name === entry.name
      if (isNext || isNow) {
        ctx.fillStyle = isNow ? "#d4b25c" : "rgba(212,178,92,0.25)"
        ctx.fillRect(40, y - 36, 432, 48)
      }
      ctx.fillStyle = isNow ? "#123b2c" : entry.name === "Terbit" ? "#9fb8ad" : "#f5f1e6"
      ctx.font = "500 32px Inter, sans-serif"
      ctx.textAlign = "left"
      ctx.fillText(entry.name, 64, y)
      ctx.textAlign = "right"
      ctx.fillText(hhmm(entry.at), 448, y)
    })

    ctx.textAlign = "center"
    ctx.fillStyle = "#f5e6b8"
    ctx.font = "500 28px Inter, sans-serif"
    const footer = session
      ? phase?.phase === "sholat"
        ? `Sholat ${session.name} · rakaat ${phase.rakaat}/${session.rakaat}`
        : phase?.phase === "doa"
          ? "Dzikir & doa"
          : phase?.phase === "khutbah"
            ? "Khutbah Jumat"
            : `Iqamah ${countdown(session.iqamah - now)}`
      : `${next.name} dalam ${countdown(next.at.getTime() - now)}`
    ctx.fillText(footer, 256, 590)
    texture.needsUpdate = true
  }, [second, schedule, session, phase?.phase, phase?.rakaat]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[1.25, 1.55, 0.05]} />
        <meshStandardMaterial color="#8a6d1f" />
      </mesh>
      <mesh position={[0, 0, 0.03]}>
        <planeGeometry args={[1.18, 1.475]} />
        <meshStandardMaterial map={texture} emissive="#ffffff" emissiveMap={texture} emissiveIntensity={0.25} />
      </mesh>
    </group>
  )
}

function useCarpetTexture() {
  return useMemo(() => {
    const c = Object.assign(document.createElement("canvas"), { width: 512, height: 640 })
    const ctx = c.getContext("2d")!
    ctx.fillStyle = "#2f6b4f"
    ctx.fillRect(0, 0, 512, 640)
    // saf lines: one band per row, facing the back wall (top of the texture)
    for (let row = 0; row < 6; row++) {
      const y = 60 + row * 106
      ctx.fillStyle = "#3a7d5d"
      ctx.fillRect(0, y, 512, 70)
      ctx.strokeStyle = "#d4b25c"
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(512, y)
      ctx.stroke()
      for (let col = 0; col < 7; col++) {
        const x = 20 + col * 72
        ctx.beginPath()
        ctx.moveTo(x, y + 70)
        ctx.lineTo(x, y + 18)
        ctx.arc(x + 26, y + 18, 26, Math.PI, 0)
        ctx.lineTo(x + 52, y + 70)
        ctx.strokeStyle = "rgba(212,178,92,0.55)"
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    return t
  }, [])
}

/** Prayer room on the right of the office. */
function Musholla({ prayer }: { prayer: PrayerView }) {
  const sign = useSignTexture("MUSHOLLA")
  const carpet = useCarpetTexture()
  const { minX, maxX, minZ, maxZ, partitionX } = MUSHOLLA
  const w = maxX - minX
  const d = maxZ - minZ
  const cx = (minX + maxX) / 2
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.012, (minZ + maxZ) / 2]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={carpet} />
      </mesh>
      {/* low partition with an opening at the front */}
      <mesh position={[partitionX, 0.55, (minZ + maxZ) / 2 - 0.4]} castShadow>
        <boxGeometry args={[0.12, 1.1, d - 0.8]} />
        <meshStandardMaterial color="#e2d6c1" />
      </mesh>
      <mesh position={[partitionX, 1.12, (minZ + maxZ) / 2 - 0.4]}>
        <boxGeometry args={[0.18, 0.05, d - 0.8]} />
        <meshStandardMaterial color="#b98b5e" />
      </mesh>
      {/* mihrab */}
      <group position={[15.2, 0, ROOM.minZ + 0.02]}>
        <mesh position={[0, 1.05, 0]}>
          <planeGeometry args={[1.3, 2.1]} />
          <meshStandardMaterial color="#d9c9a3" />
        </mesh>
        <mesh position={[0, 2.1, 0]}>
          <circleGeometry args={[0.65, 32, 0, Math.PI]} />
          <meshStandardMaterial color="#d9c9a3" />
        </mesh>
        <mesh position={[0, 1.0, 0.01]}>
          <planeGeometry args={[1.0, 2.0]} />
          <meshStandardMaterial color="#1f5a43" />
        </mesh>
        <mesh position={[0, 2.0, 0.01]}>
          <circleGeometry args={[0.5, 32, 0, Math.PI]} />
          <meshStandardMaterial color="#1f5a43" />
        </mesh>
      </group>
      <mesh position={[15.2, 3.05, ROOM.minZ + 0.03]}>
        <planeGeometry args={[1.8, 0.56]} />
        <meshStandardMaterial map={sign} />
      </mesh>
      <ScheduleBoard prayer={prayer} position={[13.3, 1.75, ROOM.minZ + 0.05]} />
      <WallClock position={[17.1, 2.2, ROOM.minZ + 0.03]} />
      {/* shoe rack by the entrance */}
      <group position={[12.9, 0, 0.3]}>
        <mesh position={[0, 0.2, 0]} castShadow>
          <boxGeometry args={[0.9, 0.4, 0.35]} />
          <meshStandardMaterial color="#b98b5e" />
        </mesh>
        {[-0.3, -0.1, 0.12, 0.3].map((x, i) => (
          <mesh key={x} position={[x, 0.44, 0]}>
            <boxGeometry args={[0.1, 0.07, 0.26]} />
            <meshStandardMaterial color={["#2f3137", "#f4f1ea", "#7c4dcc", "#c2410c"][i]} />
          </mesh>
        ))}
      </group>
      <Plant position={[17.6, 0, 0.4]} scale={0.9} />
    </group>
  )
}

export function Room({ gaming, prayer }: { gaming: number; prayer: PrayerView }) {
  const floor = useFloorTexture()
  const w = ROOM.maxX - ROOM.minX
  const d = ROOM.maxZ - ROOM.minZ
  const cx = (ROOM.maxX + ROOM.minX) / 2
  const cz = (ROOM.maxZ + ROOM.minZ) / 2
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={floor} />
      </mesh>
      {/* back + left walls */}
      <mesh position={[cx, ROOM.wallH / 2, ROOM.minZ - 0.1]} receiveShadow>
        <boxGeometry args={[w + 0.4, ROOM.wallH, 0.2]} />
        <meshStandardMaterial color="#d9c8b2" />
      </mesh>
      <mesh position={[ROOM.minX - 0.1, ROOM.wallH / 2, cz]} receiveShadow>
        <boxGeometry args={[0.2, ROOM.wallH, d]} />
        <meshStandardMaterial color="#cdbba4" />
      </mesh>
      {/* skirting */}
      <mesh position={[cx, 0.06, ROOM.minZ + 0.02]}>
        <boxGeometry args={[w, 0.12, 0.04]} />
        <meshStandardMaterial color="#ddd6ca" />
      </mesh>
      <NightWindow x={8.0} />
      <StringLights from={[-10.6, ROOM.minZ + 0.12]} to={[-2.8, ROOM.minZ + 0.12]} />
      <StringLights from={[ROOM.minX + 0.12, -7.6]} to={[ROOM.minX + 0.12, 1.2]} />
      <StringLights from={[12.5, ROOM.minZ + 0.12]} to={[17.8, ROOM.minZ + 0.12]} count={16} y={3.2} />
      {/* bar + lounge + musholla lighting */}
      <PendantLamp position={[-9.3, 0, -2.7]} height={2.25} size={0.7} intensity={5} distance={5} />
      <PendantLamp position={[-9.3, 0, -1.3]} height={2.25} size={0.7} intensity={5} distance={5} />
      <FloorLamp position={[-9.8, 0, 6.3]} />
      <pointLight position={[15.2, 2.6, -4.5]} color="#ffe1a8" intensity={6} distance={8} decay={1.6} />
      <CorkBoard />
      <Lounge gaming={gaming} />
      <CoffeeBar />
      <Musholla prayer={prayer} />
      <WallClock position={[5.6, 2.4, ROOM.minZ + 0.03]} />
      <Plant position={[ROOM.minX + 0.6, 0, -7.3]} />
      <Plant position={[11.8, 0, -7.4]} scale={1.1} />
      <Plant position={[-3, 0, -7.3]} scale={0.9} />
    </group>
  )
}
