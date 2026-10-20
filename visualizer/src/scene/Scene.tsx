import { OrbitControls, OrthographicCamera } from "@react-three/drei"
import { useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import type { OrthographicCamera as OrthoCam } from "three"
import { ORCHESTRATOR, SUBAGENTS } from "../agents"
import type { AgentState, OfficeState } from "../office"
import { phaseAt, type PrayerSession } from "../prayer"
import { ROOMS, seatSpot, visitSpot } from "../rooms"
import { ACTIVITY_LABEL, imamSpot, SAF_SPOTS, SLOT_BY_KEY, type Spot } from "../spots"
import type { PrayerView } from "../usePrayer"
import type { Pose } from "./Character"
import { Room, ROOM } from "./Room"
import { RoundTableRoom } from "./RoundTableRoom"
import { TaskBoard } from "./TaskBoard"
import { Worker } from "./Worker"

const CENTER: [number, number, number] = [-0.8, 0, -4.2]
const CHEER_MS = 2200

/** Keeps the whole office in frame when the viewport resizes. */
function FitCamera() {
  const { camera, size } = useThree()
  useEffect(() => {
    const cam = camera as OrthoCam
    cam.zoom = Math.max(9, Math.min(size.width / 38, size.height / 23))
    cam.updateProjectionMatrix()
  }, [camera, size])
  return null
}

/** Pose getter for an agent sitting at its own desk, driven by its status. */
function useDeskPose(state: AgentState | undefined) {
  const status = state?.status ?? "idle"
  const ref = useRef({ status, doneAt: 0 })
  if (ref.current.status !== status) ref.current = { status, doneAt: status === "done" ? performance.now() : 0 }
  return (): Pose => {
    const s = ref.current
    if (s.status === "working") return "typing"
    if (s.status === "error") return "slump"
    if (s.status === "done" && performance.now() - s.doneAt < CHEER_MS) return "cheer"
    return "desk-idle"
  }
}

const SAF_BY_KEY = new Map(SAF_SPOTS.map((s) => [s.key, s]))

/** Spot + pose for an agent taking part in the congregational prayer. */
function prayerPlace(place: string, session: PrayerSession): { spot: Spot; pose: () => Pose } {
  const khutbah = () => phaseAt(session, Date.now()).phase === "khutbah"
  if (place === "imam") {
    return {
      spot: imamSpot(khutbah()),
      pose: () => (khutbah() ? "talk" : phaseAt(session, Date.now()).pose),
    }
  }
  return { spot: SAF_BY_KEY.get(place)!, pose: () => phaseAt(session, Date.now()).pose }
}

type AgentProps = {
  id: string
  state?: AgentState
  slotKey?: string
  place?: string
  session?: PrayerSession
  focused: boolean
  onSelect: (id: string) => void
}

function SubagentWorker({ id, state, slotKey, place, session, focused, onSelect }: AgentProps) {
  const agent = SUBAGENTS.find((a) => a.id === id)!
  const slot = slotKey ? SLOT_BY_KEY.get(slotKey) : undefined
  const desk = useMemo(() => seatSpot(id), [id])
  const deskPose = useDeskPose(state)

  let spot: Spot = slot ?? desk
  let pose = (): Pose => (spot.pose === "desk" ? deskPose() : (spot.pose as Pose))
  let badge = slot ? ACTIVITY_LABEL[slot.activity].emoji : undefined
  if (place && session) {
    ;({ spot, pose } = prayerPlace(place, session))
    badge = "🕌"
  }
  return (
    <Worker agent={agent} state={state} spot={spot} pose={pose} badge={badge} quiet={Boolean(place && session)} focused={focused} onSelect={onSelect} />
  )
}

type Props = {
  state: OfficeState
  hangouts: Record<string, string>
  prayer: PrayerView
  focused: string | null
  onSelect: (id: string | null) => void
}

export function Scene({ state, hangouts, prayer, focused, onSelect }: Props) {
  const slotByAgent = useMemo(() => Object.fromEntries(Object.entries(hangouts).map(([slot, agent]) => [agent, slot])), [hangouts])
  const gaming = Object.keys(hangouts).filter((k) => k.startsWith("ps5")).length

  const target = state.orchestratorTarget
  const home = useMemo(() => seatSpot(ORCHESTRATOR.id), [])
  const orchSpot = useMemo(() => (target && SUBAGENTS.some((a) => a.id === target) ? visitSpot(target) : home), [target, home])
  const orchState = state.agents.orchestrator
  const orchPlace = prayer.session && prayer.places.orchestrator ? prayerPlace(prayer.places.orchestrator, prayer.session) : undefined
  // Visiting a teammate: talk. At the Manager table: type while working, sip coffee otherwise.
  const orchPose = (): Pose => (orchSpot.pose === "talk" ? "talk" : orchState?.status === "working" ? "typing" : "sip-sit")

  return (
    <>
      <color attach="background" args={["#0f1220"]} />
      <OrthographicCamera makeDefault position={[CENTER[0] + 20, 22, CENTER[2] + 20]} near={-50} far={200} />
      <FitCamera />
      <OrbitControls
        target={CENTER}
        enableRotate
        minPolarAngle={0.5}
        maxPolarAngle={1.1}
        minAzimuthAngle={0.2}
        maxAzimuthAngle={1.35}
        minZoom={12}
        maxZoom={120}
      />

      <hemisphereLight args={["#8fa2e0", "#3a2c22", 0.55]} />
      <directionalLight
        position={[10, 18, 8]}
        color="#a9bcff"
        intensity={0.55}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-bias={-0.0005}
      />

      <group onPointerMissed={() => onSelect(null)}>
        <Room gaming={gaming} prayer={prayer} />
        <TaskBoard state={state} position={[1.0, 1.85, ROOM.minZ + 0.06]} />
        {ROOMS.map((room) => (
          <RoundTableRoom key={room.id} room={room} agents={state.agents} />
        ))}
        {SUBAGENTS.map((agent) => (
          <SubagentWorker
            key={agent.id}
            id={agent.id}
            state={state.agents[agent.id]}
            slotKey={slotByAgent[agent.id]}
            place={prayer.places[agent.id]}
            session={prayer.session}
            focused={focused === agent.id}
            onSelect={onSelect}
          />
        ))}
        <Worker
          agent={ORCHESTRATOR}
          state={orchState}
          spot={orchPlace?.spot ?? orchSpot}
          pose={orchPlace?.pose ?? orchPose}
          badge={orchPlace ? "🕌" : undefined}
          quiet={Boolean(orchPlace)}
          focused={focused === ORCHESTRATOR.id}
          onSelect={onSelect}
        />
      </group>
    </>
  )
}
