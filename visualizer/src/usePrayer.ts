import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ORCHESTRATOR, ORCHESTRATOR_ID, SUBAGENTS } from "./agents"
import type { AgentState } from "./office"
import {
  activeSession,
  createSession,
  nextPrayer,
  phaseAt,
  prayerSchedule,
  type PrayerName,
  type PrayerPhase,
  type PrayerSession,
  type ScheduleEntry,
} from "./prayer"
import { safSpotsFor } from "./spots"

export type PrayerView = {
  now: number
  schedule: ScheduleEntry[]
  next: ScheduleEntry
  session?: PrayerSession
  phase?: PrayerPhase
  /** agent id → "imam" | saf spot key */
  places: Record<string, string>
  startTest: () => void
}

const params = new URLSearchParams(location.search)
const TEST_PARAM = params.get("sholat")
// ?sholat=ashar&sholatT=70 starts the test session 70s in (handy for checking poses).
const TEST_OFFSET_MS = Number(params.get("sholatT") ?? 0) * 1000

function testName(value: string | null, now: Date): PrayerName {
  const names: PrayerName[] = ["Subuh", "Dzuhur", "Jumat", "Ashar", "Maghrib", "Isya"]
  const match = names.find((n) => n.toLowerCase() === value?.toLowerCase())
  if (match) return match
  const next = nextPrayer(now).name
  return next === "Terbit" ? "Dzuhur" : next
}

/** Clock, today's schedule, and the running congregational prayer with each agent's place. */
export function usePrayer(agents: Record<string, AgentState>): PrayerView {
  const [now, setNow] = useState(Date.now())
  const [test, setTest] = useState<PrayerSession | undefined>(() =>
    TEST_PARAM !== null ? createSession(testName(TEST_PARAM, new Date()), Date.now() - TEST_OFFSET_MS) : undefined,
  )

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const day = new Date(now).toDateString()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const schedule = useMemo(() => prayerSchedule(new Date(now)), [day])
  const next = nextPrayer(new Date(now))

  const session = test && now < test.end ? test : activeSession(schedule, now)
  const phase = session && phaseAt(session, now)

  // Sticky places: nobody shuffles when someone leaves or joins mid-prayer.
  const placesRef = useRef<{ session?: number; places: Record<string, string> }>({ places: {} })
  const places = useMemo(() => {
    if (!session) return (placesRef.current = { places: {} }).places
    const prev = placesRef.current.session === session.start ? placesRef.current.places : {}
    const free = (id: string) => agents[id]?.status !== "working"
    const nextPlaces: Record<string, string> = {}
    for (const [id, place] of Object.entries(prev)) if (free(id)) nextPlaces[id] = place

    const taken = new Set(Object.values(nextPlaces))
    const genderOf = (id: string) => (id === ORCHESTRATOR_ID ? ORCHESTRATOR : SUBAGENTS.find((a) => a.id === id))?.gender ?? "male"
    // The orchestrator goes first so it leads as imam; if it is busy, the first free man leads instead. Women never lead.
    const candidates = [ORCHESTRATOR_ID, ...SUBAGENTS.map((a) => a.id)].filter((id) => free(id) && !nextPlaces[id])
    for (const id of candidates) {
      const gender = genderOf(id)
      const leads = !taken.has("imam") && gender === "male" && (id === ORCHESTRATOR_ID || Object.keys(prev).length === 0)
      const place = leads ? "imam" : safSpotsFor(gender).find((s) => !taken.has(s.key))?.key
      if (!place) continue
      nextPlaces[id] = place
      taken.add(place)
    }
    placesRef.current = { session: session.start, places: nextPlaces }
    return nextPlaces
  }, [session?.start, agents]) // eslint-disable-line react-hooks/exhaustive-deps

  const startTest = useCallback(() => setTest(createSession(testName(null, new Date()), Date.now())), [])

  return { now, schedule, next, session, phase, places, startTest }
}
