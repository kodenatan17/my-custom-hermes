export function emit(event: Record<string, unknown>): Promise<boolean>
export function truncate(s: string, n?: number): string
export function basename(p: unknown): string
export type ClaimRequest = { owner: string; source: string; sessionID?: string; agent?: string; path: string; priority?: string; phase?: string }
export type ClaimResult = {
  granted: boolean
  failOpen?: boolean
  override?: boolean
  feature?: string | null
  holder?: { source: string; sessionID?: string; agent?: string }
  queuePosition?: number
  reason?: string
  waitedMs?: number
}
export function claim(req: ClaimRequest, maxWaitMs?: number): Promise<ClaimResult>
export function release(req: { owner: string; feature?: string }): Promise<unknown>
export function supersede(req: { owner: string; source: string }): Promise<unknown>
export function isWrite(tool: unknown): boolean
export function relPath(p: unknown, root?: string): string
export function coordination(): {
  maxWaitSeconds: Record<string, number>
  phaseByAgent: Record<string, string>
  priorityDefault: string
  phaseDefault: string
  [k: string]: unknown
}
