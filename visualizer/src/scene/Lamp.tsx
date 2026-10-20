import { useFrame } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import { DoubleSide, type PointLight } from "three"

const CEILING_Y = 3.4

type Props = {
  position: [number, number, number]
  color?: string
  intensity?: number
  distance?: number
  /** Height of the bulb above the floor. */
  height?: number
  shade?: string
  size?: number
}

/** Warm pendant lamp hanging from the ceiling line, with a softly breathing point light. */
export function PendantLamp({ position, color = "#ffc98a", intensity = 9, distance = 8, height = 2.4, shade = "#2b2622", size = 1 }: Props) {
  const light = useRef<PointLight>(null!)
  const phase = useMemo(() => Math.random() * 10, [])
  useFrame(({ clock }) => {
    light.current.intensity = intensity * (1 + Math.sin(clock.elapsedTime * 1.3 + phase) * 0.04)
  })
  const cordTop = CEILING_Y
  const cordBottom = height + 0.28 * size
  return (
    <group position={position}>
      <mesh position={[0, (cordTop + cordBottom) / 2, 0]}>
        <cylinderGeometry args={[0.012, 0.012, cordTop - cordBottom, 6]} />
        <meshStandardMaterial color="#1d1b19" />
      </mesh>
      <mesh position={[0, height + 0.12 * size, 0]}>
        <coneGeometry args={[0.36 * size, 0.32 * size, 24, 1, true]} />
        <meshStandardMaterial color={shade} side={DoubleSide} roughness={0.6} />
      </mesh>
      <mesh position={[0, height, 0]}>
        <sphereGeometry args={[0.09 * size, 12, 10]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={4} />
      </mesh>
      <pointLight ref={light} position={[0, height - 0.15, 0]} color={color} intensity={intensity} distance={distance} decay={1.6} />
    </group>
  )
}

/** Floor lamp with a fabric shade (lounge corner). */
export function FloorLamp({ position, color = "#ffc48a", intensity = 7 }: { position: [number, number, number]; color?: string; intensity?: number }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.22, 0.25, 0.04, 20]} />
        <meshStandardMaterial color="#2b2622" />
      </mesh>
      <mesh position={[0, 0.8, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 1.6, 8]} />
        <meshStandardMaterial color="#2b2622" />
      </mesh>
      <mesh position={[0, 1.65, 0]}>
        <cylinderGeometry args={[0.2, 0.32, 0.38, 20, 1, true]} />
        <meshStandardMaterial color="#f3dcb8" emissive={color} emissiveIntensity={0.6} side={DoubleSide} />
      </mesh>
      <pointLight position={[0, 1.55, 0]} color={color} intensity={intensity} distance={6} decay={1.6} />
    </group>
  )
}
