---
name: security-boundaries
description: App-side security rules for Seedly: token handling, secure storage, re-auth, upload validation, no local authority over XP/score.
---

# Skill: security-boundaries

## Purpose

The Flutter app is explicitly "a projection surface, not a trust boundary" — it holds no secrets and never verifies its own claims. This skill encodes the app-side half of Seedly's security model. Device auth (HMAC/token) and admin auth (CMS session/RBAC) belong to workspaces that build those systems, not this one — mentioned here only so the app never accidentally reimplements or assumes them.

## When to Use

- Any task touching how the app authenticates, stores a token, or handles an auth-related error.
- Any task involving photo/file selection before upload.

## When Not to Use

- Device (ESP32) or admin (CMS) authentication mechanics — out of scope for this workspace; the app only ever consumes their *effects* (e.g. a device's `REVOKED` status), never their auth mechanism. The CMS equivalent is `cms-security-boundaries`.

## Constraints

- The app never stores or trusts a locally-computed value for anything server-authoritative (XP, level, score, mission/quest state, subscription tier, mastery tier) — always re-fetch/display the server's value; a local optimistic update, if used, must be reconciled against the next server response.
- The app holds only the Firebase ID token / SEEDLY access/refresh token — never a device secret, never an admin session token, never a raw API key.
- Store tokens using secure platform storage (not plain `shared_preferences`) — never log a token or embed one in a crash report.
- On `401`/`403`, the app must re-authenticate or sign the user out — never silently retry with the same rejected credential in a loop.
- Client-side pre-checks on an image (size, format) before upload are a UX convenience only — the backend's own validation (magic-bytes, EXIF strip) is authoritative; the app must handle a server-side rejection even if its own pre-check passed.
- Never hardcode a backend URL, API key, or environment secret in app source — use build-time configuration.

## Depends On

- `api-contract-conventions` (the header this skill requires the app to attach).

## Source References

- `garden-ai/solutioning/specs/architecture/apps/ARCHITECTURE_DECISIONS.md` — "App auth via Firebase ID tokens — never trust client claims; the app only holds Firebase credentials, never device or backend secrets." "App is a projection surface, not a trust boundary." "Client stores no secrets; relies on server-verified tokens."
- `garden-ai/solutioning/specs/architecture/be/ARCHITECTURE_DECISIONS.md` "Security (backend)" — cited only for context on the *other* two auth surfaces (device, admin) so the app never mistakes their behavior for something it should replicate.

## Conventions

- Wrap every authenticated call through one client/interceptor that attaches the current token and handles `401` centrally — don't attach auth headers ad hoc per call site.
- When a feature depends on `subscriptionTier`-gated behavior (e.g. AI chat quota), read the tier from the server response (`GET /v1/me`, `GET /v1/me/chat-quota`) — never infer it from a locally cached flag that could go stale.
- When the guided-camera flow captures a photo, perform local checks (blur/brightness/size) as fast feedback only — always still submit to the server and honor its verdict as final.
