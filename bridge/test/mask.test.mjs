import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { clipMasked, mask, maskDeep } from "../mask.mjs"
import { truncate } from "../emit.mjs"

describe("mask()", () => {
  const cases = [
    ["PEM private key", "k=-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY----- tail", /MIIEow/],
    ["clipped PEM (no END)", "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADAN", /MIIEvQ/],
    ["Authorization header", "curl -H 'Authorization: Basic dXNlcjpwYXNz' x", /dXNlcjpwYXNz/],
    ["Bearer token", "token is Bearer abcdefgh12345 ok", /abcdefgh12345/],
    ["URL credentials", "git clone https://bob:s3cr3t@github.com/x.git", /bob|s3cr3t/],
    ["query token", "GET /cb?code=1&access_token=abc123&x=1", /abc123/],
    ["query sig", "https://s3/x?sig=QWERTY", /QWERTY/],
    ["password=", "export PASSWORD=hunter2", /hunter2/],
    ["json secret", '{"client_secret": "zzz-123", "id": 1}', /zzz-123/],
    ["api-key:", "api-key: kkk999", /kkk999/],
    ["cookie", "Cookie=abc; other", /abc;/],
    ["sk-", "use sk-proj-abcdefghijklmnop1234", /abcdefghijklmnop1234/],
    ["ghp_", "ghp_abcdefghijklmnopqrstuvwxyz0123", /abcdefghijklmnop/],
    ["github_pat_", "github_pat_11ABCDEFG_xyz", /11ABCDEFG/],
    ["glpat-", "glpat-AbCdEf123", /AbCdEf123/],
    ["slack", "xoxb-123-456-abc", /123-456/],
    ["AWS", "AKIAIOSFODNN7EXAMPLE", /IOSFODNN7/],
    ["Google", "AIza" + "x".repeat(35), /xxxxxxxx/],
    ["npm", "npm_" + "a".repeat(36), /aaaaaaaa/],
    ["JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sflKxwRJSMeKKF2QT4fwpM", /sflKxw/],
  ]
  for (const [name, input, leak] of cases) {
    test(name, () => {
      const out = mask(input)
      assert.doesNotMatch(out, leak, out)
      assert.match(out, /\*\*\*/)
    })
  }
  test("plain text and non-strings pass through unchanged", () => {
    assert.equal(mask("read auth_bloc.dart and fix the login"), "read auth_bloc.dart and fix the login")
    assert.equal(mask(42), 42)
    assert.equal(mask(undefined), undefined)
  })
  test("idempotent", () => assert.equal(mask(mask("password=abc")), mask("password=abc")))
})

describe("maskDeep()", () => {
  test("masks nested strings and values under secret-looking keys; keeps routing ids", () => {
    const out = maskDeep({ sessionID: "claude:S1", correlationId: "claude:t", nested: { apiKey: "k", list: ["Bearer abcdefghijk"] }, password: 5, ok: "fine" })
    assert.deepEqual(out, { sessionID: "claude:S1", correlationId: "claude:t", nested: { apiKey: "***", list: ["Bearer ***"] }, password: "***", ok: "fine" })
  })
  test("survives cycles", () => {
    const a = { x: "y" }
    a.self = a
    assert.deepEqual(maskDeep(a), { x: "y", self: "[…]" })
  })
})

describe("clipMasked()", () => {
  test("masks BEFORE clipping (a clipped token cannot leak its prefix)", () => {
    const s = "x".repeat(10) + " sk-abcdefghijklmnopqrstuvwxyz"
    const out = clipMasked(s, 20)
    assert.equal(out.length <= 20, true)
    assert.doesNotMatch(out, /sk-abc/)
  })
  test("non-strings and empty => undefined", () => {
    assert.equal(clipMasked(undefined, 10), undefined)
    assert.equal(clipMasked("", 10), undefined)
    assert.equal(clipMasked({}, 10), undefined)
  })
})

describe("review round 1", () => {
  test("truncate masks BEFORE clipping: a URL credential cut at the boundary does not leak", () => {
    const s = "x".repeat(40) + " https://admin:SuperSecretPass@host.example/repo"
    for (const n of [50, 55, 58, 60, 64, 72]) {
      const out = truncate(s, n)
      assert.ok(out.length <= n, `len ${out.length} > ${n}`)
      assert.doesNotMatch(out, /admin|Sup|Secret/, `n=${n}: ${out}`)
    }
  })
  test("ReDoS: secret-key rule stays linear on long whitespace runs (<200ms)", () => {
    for (const k of ["token", "password", "api_key", "Authorization", "client_secret\"", "Bearer"]) {
      const s = k + " ".repeat(60_000) + "x"
      const t0 = performance.now()
      mask(s)
      clipMasked(s, 4000)
      const took = performance.now() - t0
      assert.ok(took < 200, `${k}: ${took.toFixed(1)}ms`)
    }
  })
  test("clipMasked bounds regex work but still masks a token at the clip edge", () => {
    const s = "a".repeat(3990) + " sk-abcdefghijklmnopqrstuvwxyz" + "b".repeat(100_000)
    const out = clipMasked(s, 4000)
    assert.ok(out.length <= 4000)
    assert.doesNotMatch(out, /sk-a/)
  })
})
