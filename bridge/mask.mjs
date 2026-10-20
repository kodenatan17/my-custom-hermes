// Secret masking shared by every producer (hook.mjs, office-bridge plugin), emit(), the daemon and the visualizer.
// Best-effort and conservative: over-masking is fine, leaking is not. Zero dependencies, browser-safe.

const M = "***"

/** [pattern, replacement] pairs, applied in order (most specific first). */
const RULES = [
  // PEM private keys (also a clipped one with no END line).
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, M],
  // Authorization header values (Bearer/Basic/raw), up to the end of the line or a quote.
  [/(authorization["']?\s*[:=]\s*["']?)[^"'\r\n]+/gi, `$1${M}`],
  [/(\bBearer\s+)[\w.~+/=-]{8,}/gi, `$1${M}`],
  // URL credentials ://user:pass@host
  [/(:\/\/)[^\s/:@]+:[^\s/@]+@/g, `$1${M}:${M}@`],
  // Secret-looking query parameters.
  [/([?&](?:token|key|sig|signature|access_token|api_key)=)[^&\s#"']+/gi, `$1${M}`],
  // Well-known token prefixes.
  [/\bsk-[\w-]{16,}/g, M],
  [/\bgh[pousr]_\w{20,}/g, M],
  [/\bgithub_pat_\w+/g, M],
  [/\bglpat-[\w-]+/g, M],
  [/\bxox[abprs]-[\w-]+/g, M],
  [/\bAKIA[0-9A-Z]{16}\b/g, M],
  [/\bAIza[\w-]{35}/g, M],
  [/\bnpm_\w{36}/g, M],
  // JWT
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, M],
  // key=value / key: value / "key": "value" for secret-looking keys.
  [
    // `\s*(?:["']\s*)?` (not `\s*["']?\s*`): adjacent optional runs backtrack quadratically on long whitespace.
    /((?:pass(?:word)?|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|cookie|session[_-]?id|credential)s?\s*(?:["']\s*)?[:=]\s*)(?:"[^"\n]*"?|'[^'\n]*'?|[^\s,;&}]+)/gi,
    `$1${M}`,
  ],
]

/** Object keys whose values are always masked by maskDeep. */
const SECRET_KEY = /pass(word)?|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|cookie|session[_-]?id|credential|authorization/i
/** Bridge envelope ids that look secret-ish by name but are routing metadata, never credentials. */
const SAFE_KEYS = new Set(["sessionID", "childSessionID", "correlationId", "eventId", "owner"])

/**
 * Masks secrets inside a string. Non-strings are returned unchanged.
 * @template T
 * @param {T} str
 * @returns {T}
 */
export function mask(str) {
  if (typeof str !== "string" || str.length === 0) return str
  let out = str
  for (const [re, rep] of RULES) out = out.replace(re, rep)
  return /** @type {T} */ (out)
}

/**
 * Deep copy of `obj` with every string masked and every value under a secret-looking key replaced by "***".
 * Cycles and depth > 8 collapse to "[…]".
 * @param {unknown} obj
 * @returns {unknown}
 */
export function maskDeep(obj) {
  const seen = new WeakSet()
  /** @param {unknown} v @param {number} depth @returns {unknown} */
  const walk = (v, depth) => {
    if (typeof v === "string") return mask(v)
    if (!v || typeof v !== "object") return v
    if (depth > 8 || seen.has(v)) return "[…]"
    seen.add(v)
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1))
    /** @type {Record<string, unknown>} */
    const out = {}
    for (const [k, x] of Object.entries(v)) {
      out[k] = !SAFE_KEYS.has(k) && SECRET_KEY.test(k) && x !== undefined && x !== null && x !== "" ? M : walk(x, depth + 1)
    }
    return out
  }
  return walk(obj, 0)
}

const CLIP_MARGIN = 256

/**
 * Masks first, then clips to `n` chars (clipping first could shorten a token below its pattern's length and leak it).
 * Returns undefined for non-strings and empty strings.
 * @param {unknown} v
 * @param {number} n
 * @returns {string | undefined}
 */
export function clipMasked(v, n) {
  if (typeof v !== "string" || v.length === 0) return undefined
  // Bound the regex work: pre-slice with a margin (so a token at the edge still matches), mask, then the final clip.
  const m = mask(v.length > n + CLIP_MARGIN ? v.slice(0, n + CLIP_MARGIN) : v)
  return m.length > n ? m.slice(0, n) : m
}
