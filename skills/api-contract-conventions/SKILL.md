---
name: api-contract-conventions
description: How the Seedly app calls the backend API: endpoints, pagination, error envelopes, polling, auth headers.
---

# Skill: api-contract-conventions

## Purpose

This opencode workspace builds only the **Seedly Flutter app** (`seedly_app/`) — never the Go backend, ESP32 firmware, or Next.js CMS. The app is a *consumer* of the backend's already-documented API contract. This skill encodes how the app must call that API correctly (headers, pagination, error handling, idempotency) — it does not cover how the backend implements the endpoint, which is out of scope for every agent in this workspace.

## When to Use

- Any task where the app calls, parses, or handles the result of a `/v1/*` backend endpoint.
- Adding a repository/service class that wraps an HTTP call.

## When Not to Use

- Backend, CMS, or firmware implementation — not in scope for this workspace at all.

## Constraints

- The app only ever calls `/v1/*` (app surface) endpoints — never `/v1/admin/*` (CMS-only) or `/v1/iot/*` (device-only).
- Every mutating call (`POST`/`PATCH`/`DELETE`) the app makes must attach an `Idempotency-Key` header (a fresh UUID per logical action) — required for correctness, not optional.
- Auth header is always `Authorization: Bearer <Firebase ID token>` or `<SEEDLY access token>` — the app never constructs a device or admin auth header.
- Parse the standard error envelope `{ "error": { "code", "message", "details?" } }` uniformly — don't special-case error handling per endpoint.
- List/feed endpoints are cursor-paginated (`?cursor=&limit=`) — the app must carry the returned `cursor`/`nextCursor` forward, never assume offset-based paging.
- Async flows (photo upload, growth-check, growth-story) return `202 Accepted` with a job/status id — the app must poll the corresponding status endpoint, never assume a synchronous result.
- Never invent a request/response field that isn't documented in the spec — if a screen needs data the contract doesn't provide, that's a spec gap to flag, not a field to guess at.

## Depends On

- `spec-first` (the exact request/response shape for a given screen comes from the feature spec + `api_contracts_backend.md`, not from inference).

## Source References

- `garden-ai/solutioning/specs/contracts/api_contracts_backend.md` §1 "Global API Standards & Conventions" — the authoritative consolidated app/device contract (app-relevant parts: §1.1–1.3, and every endpoint listed under `/v1/*`).
- `garden-ai/solutioning/specs/domain/be/API_ARCHITECTURE.md` §9.1 — versioning, error envelope, cursor pagination, `Idempotency-Key`.
- `garden-ai/solutioning/specs/architecture/apps/ARCHITECTURE_DECISIONS.md` — "App auth via Firebase ID tokens — never trust client claims; the app only holds Firebase credentials, never device or backend secrets."

## Conventions

- Before wiring a screen to an endpoint, read that feature's spec section in `api_contracts_backend.md` for the exact field names (camelCase) and enum values (SNAKE_CASE) — don't guess casing or naming.
- Model async submission flows (guided camera, growth-check) on the existing pattern: submit → `202` with an id → poll a status endpoint → render the terminal state (`COMPLETED`/`FAILED`/`APPROVED`/`REJECTED`/etc., per that endpoint's documented enum).
- Surface the backend's `error.code` to the user via a mapped, human-readable message — don't display raw backend error codes in the UI.
- When a spec marks a field/behavior as "Open"/"Unresolved," build defensively (handle its absence) rather than assuming a shape that isn't finalized yet.
