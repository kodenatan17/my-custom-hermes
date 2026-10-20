/**
 * Prayer times (Kemenag RI parameters: Subuh 20°, Isya 18°, Ashar Syafi'i, +2 min ihtiyat)
 * and the choreography of a congregational prayer.
 *
 * Location: ?lat=..&lng=..&city=.. (default Jakarta). Times use the browser's timezone.
 */

const params = new URLSearchParams(location.search)
export const LOCATION = {
  lat: Number(params.get("lat") ?? -6.2088),
  lng: Number(params.get("lng") ?? 106.8456),
  city: params.get("city") ?? (params.has("lat") ? "Lokasi kamu" : "Jakarta"),
}

const FAJR_ANGLE = 20
const ISHA_ANGLE = 18
const SUN_ANGLE = 0.833
const IHTIYAT_MIN = 2

export type PrayerName = "Subuh" | "Dzuhur" | "Jumat" | "Ashar" | "Maghrib" | "Isya"
export type ScheduleEntry = { name: PrayerName | "Terbit"; at: Date }

const RAKAAT: Record<PrayerName, number> = { Subuh: 2, Dzuhur: 4, Jumat: 2, Ashar: 4, Maghrib: 3, Isya: 4 }

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
const fix = (a: number, b: number) => ((a % b) + b) % b

function julian(year: number, month: number, day: number) {
  if (month <= 2) {
    year -= 1
    month += 12
  }
  const a = Math.floor(year / 100)
  const b = 2 - a + Math.floor(a / 4)
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + b - 1524.5
}

function sunPosition(jd: number) {
  const d = jd - 2451545.0
  const g = fix(357.529 + 0.98560028 * d, 360)
  const q = fix(280.459 + 0.98564736 * d, 360)
  const l = fix(q + 1.915 * Math.sin(rad(g)) + 0.02 * Math.sin(rad(2 * g)), 360)
  const e = 23.439 - 0.00000036 * d
  const ra = deg(Math.atan2(Math.cos(rad(e)) * Math.sin(rad(l)), Math.cos(rad(l)))) / 15
  return { declination: deg(Math.asin(Math.sin(rad(e)) * Math.sin(rad(l)))), equation: q / 15 - fix(ra, 24) }
}

/** Today's schedule (including Terbit/sunrise) for the configured location. */
export function prayerSchedule(day: Date, { lat, lng } = LOCATION): ScheduleEntry[] {
  const tz = -day.getTimezoneOffset() / 60
  const { declination, equation } = sunPosition(julian(day.getFullYear(), day.getMonth() + 1, day.getDate()) - lng / 360 + 0.5)
  const dhuhr = fix(12 - equation, 24) + tz - lng / 15

  // hours from solar noon until the sun is `angle` degrees below the horizon (negative = above)
  const offset = (angle: number) =>
    deg(Math.acos((-Math.sin(rad(angle)) - Math.sin(rad(declination)) * Math.sin(rad(lat))) / (Math.cos(rad(declination)) * Math.cos(rad(lat))))) / 15
  const asrAngle = -deg(Math.atan(1 / (1 + Math.tan(rad(Math.abs(lat - declination))))))

  const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const at = (hours: number, ihtiyat = IHTIYAT_MIN) => new Date(midnight + Math.round((hours * 60 + ihtiyat)) * 60_000)

  return [
    { name: "Subuh", at: at(dhuhr - offset(FAJR_ANGLE)) },
    { name: "Terbit", at: at(dhuhr - offset(SUN_ANGLE), -IHTIYAT_MIN) },
    { name: day.getDay() === 5 ? "Jumat" : "Dzuhur", at: at(dhuhr) },
    { name: "Ashar", at: at(dhuhr + offset(asrAngle)) },
    { name: "Maghrib", at: at(dhuhr + offset(SUN_ANGLE)) },
    { name: "Isya", at: at(dhuhr + offset(ISHA_ANGLE)) },
  ]
}

// ---------------------------------------------------------------------------
// Congregational prayer choreography

export type PrayerPose = "qiyam" | "takbir" | "ruku" | "sujud" | "duduk" | "salam-r" | "salam-l" | "doa"

type Step = { pose: PrayerPose; seconds: number; rakaat: number }

const GATHER_S = 60 // walk over + wait for iqamah
const KHUTBAH_S = 180 // Jumat only
const DOA_S = 45

function choreography(rakaat: number): Step[] {
  const steps: Step[] = [{ pose: "takbir", seconds: 2.5, rakaat: 1 }]
  for (let r = 1; r <= rakaat; r++) {
    if (r > 1) steps.push({ pose: "takbir", seconds: 1.5, rakaat: r })
    steps.push(
      { pose: "qiyam", seconds: r === 1 ? 10 : 8, rakaat: r },
      { pose: "ruku", seconds: 4, rakaat: r },
      { pose: "qiyam", seconds: 2.5, rakaat: r }, // i'tidal
      { pose: "sujud", seconds: 3.5, rakaat: r },
      { pose: "duduk", seconds: 2.5, rakaat: r },
      { pose: "sujud", seconds: 3.5, rakaat: r },
    )
    if (r === 2 && rakaat > 2) steps.push({ pose: "duduk", seconds: 6, rakaat: r }) // tahiyat awal
  }
  steps.push(
    { pose: "duduk", seconds: 9, rakaat }, // tahiyat akhir
    { pose: "salam-r", seconds: 2, rakaat },
    { pose: "salam-l", seconds: 2, rakaat },
  )
  return steps
}

export type PrayerSession = {
  name: PrayerName
  rakaat: number
  start: number // adzan (ms)
  iqamah: number
  end: number
  steps: Step[]
}

export function createSession(name: PrayerName, start: number): PrayerSession {
  const rakaat = RAKAAT[name]
  const steps = choreography(rakaat)
  const iqamah = start + (GATHER_S + (name === "Jumat" ? KHUTBAH_S : 0)) * 1000
  const prayerMs = steps.reduce((sum, s) => sum + s.seconds, 0) * 1000
  return { name, rakaat, start, iqamah, end: iqamah + prayerMs + DOA_S * 1000, steps }
}

export type PrayerPhase = { phase: "menunggu" | "khutbah" | "sholat" | "doa"; pose: PrayerPose; rakaat: number }

export function phaseAt(session: PrayerSession, now: number): PrayerPhase {
  if (now < session.iqamah) {
    const khutbah = session.name === "Jumat" && now >= session.start + GATHER_S * 1000
    return { phase: khutbah ? "khutbah" : "menunggu", pose: "duduk", rakaat: 0 }
  }
  let t = (now - session.iqamah) / 1000
  for (const step of session.steps) {
    if (t < step.seconds) return { phase: "sholat", pose: step.pose, rakaat: step.rakaat }
    t -= step.seconds
  }
  return { phase: "doa", pose: "doa", rakaat: session.rakaat }
}

/** The session running at `now` today, if any. */
export function activeSession(schedule: ScheduleEntry[], now: number): PrayerSession | undefined {
  for (const entry of schedule) {
    if (entry.name === "Terbit") continue
    const session = createSession(entry.name, entry.at.getTime())
    if (now >= session.start && now < session.end) return session
  }
  return undefined
}

export function nextPrayer(now: Date): ScheduleEntry {
  const upcoming = prayerSchedule(now).find((e) => e.name !== "Terbit" && e.at.getTime() > now.getTime())
  if (upcoming) return upcoming
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return prayerSchedule(tomorrow)[0]
}

/** "1:02:33" / "02:33" */
export function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${h > 0 ? `${h}:` : ""}${pad(m)}:${pad(s % 60)}`
}
