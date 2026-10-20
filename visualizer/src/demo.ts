import type { OfficeEvent } from "./office"

type Step = [delayMs: number, event: Omit<OfficeEvent, "ts" | "sessionID"> & { sessionID?: string }]

// A scripted workflow used when no opencode instance is connected.
const SCRIPT: Step[] = [
  [600, { type: "prompt", agent: "orchestrator", text: "Tambahkan fitur reset password di halaman login" }],
  [1200, { type: "activity", agent: "orchestrator", text: "read orchestrator.md" }],
  [1500, { type: "dispatch", agent: "orchestrator", target: "scout", text: "Cari file auth & login" }],
  [900, { type: "activity", agent: "scout", text: 'grep "LoginPage"' }],
  [1300, { type: "activity", agent: "scout", text: "glob lib/features/auth/**" }],
  [1400, { type: "idle", agent: "scout" }],
  [700, { type: "dispatch", agent: "orchestrator", target: "scout", text: "Analisa alur auth bloc" }],
  [1100, { type: "activity", agent: "scout", text: "read auth_bloc.dart" }],
  [1500, { type: "activity", agent: "scout", text: "read auth_repository.dart" }],
  [1500, { type: "idle", agent: "scout" }],
  [700, { type: "dispatch", agent: "orchestrator", target: "architect", text: "Desain flow reset password" }],
  [1800, { type: "activity", agent: "architect", text: "read api-contract-conventions" }],
  [1600, { type: "idle", agent: "architect" }],
  [600, { type: "dispatch", agent: "orchestrator", target: "coder", text: "Implement ResetPasswordPage" }],
  [1000, { type: "lock.waiting", agent: "coder", source: "opencode", feature: "auth", waitingOn: { source: "claude", feature: "auth" } }],
  [1500, { type: "lock.acquired", agent: "coder", source: "opencode", feature: "auth" }],
  [500, { type: "activity", agent: "coder", text: "write reset_password_page.dart" }],
  [1600, { type: "activity", agent: "coder", text: "edit app_router.dart" }],
  [1500, { type: "activity", agent: "coder", text: "bash dart run build_runner build" }],
  [1800, { type: "idle", agent: "coder" }],
  [100, { type: "lock.released", agent: "coder", source: "opencode", feature: "auth" }],
  [400, { type: "lock.override", agent: "qa", source: "cline", feature: "auth", waitingOn: { source: "claude", feature: "auth" } }],
  [600, { type: "lock.expired", agent: "coder", source: "claude", feature: "home", reason: "stale" }],
  [600, { type: "dispatch", agent: "orchestrator", target: "qa", text: "Tulis widget test reset password" }],
  [1200, { type: "activity", agent: "qa", text: "write reset_password_test.dart" }],
  [1500, { type: "activity", agent: "qa", text: "bash flutter test test/auth" }],
  [900, { type: "error", agent: "qa", text: "1 test gagal: missing mock" }],
  [1200, { type: "dispatch", agent: "orchestrator", target: "qa", text: "Perbaiki mock AuthRepository" }],
  [1200, { type: "activity", agent: "qa", text: "edit reset_password_test.dart" }],
  [500, { type: "dispatch", agent: "orchestrator", target: "qa", text: "Jalankan ulang test" }],
  [1200, { type: "activity", agent: "qa", text: "bash flutter test test/auth" }],
  [1400, { type: "idle", agent: "qa" }],
  [600, { type: "dispatch", agent: "orchestrator", target: "reviewer", text: "Review perubahan" }],
  [1500, { type: "activity", agent: "reviewer", text: "read reset_password_page.dart" }],
  [1500, { type: "idle", agent: "reviewer" }],
  [600, { type: "dispatch", agent: "orchestrator", target: "memory-manager", text: "Evaluasi writeback memori" }],
  [1400, { type: "idle", agent: "memory-manager" }],
  [800, { type: "idle", agent: "orchestrator" }],
]

/** Plays the demo script in a loop. Returns a stop function. */
export function playDemo(onEvent: (e: OfficeEvent) => void, onRestart: () => void): () => void {
  let i = 0
  let timer: ReturnType<typeof setTimeout>
  const tick = () => {
    if (i >= SCRIPT.length) {
      i = 0
      timer = setTimeout(() => {
        onRestart()
        tick()
      }, 4000)
      return
    }
    const [delay, step] = SCRIPT[i++]
    timer = setTimeout(() => {
      onEvent({ ts: Date.now(), sessionID: step.sessionID ?? `demo-${step.agent}`, ...step })
      tick()
    }, delay)
  }
  tick()
  return () => clearTimeout(timer)
}
