---
name: be-database
description: "growpico-be PostgreSQL rules: dated SQL migrations applied by hand, schema truth, integrity guards, stale files to ignore."
---

# Skill: be-database

Load order: spec-first → be-architecture → **be-database** → be-api-contract (what the SQL must serve). Go data-access patterns: golang-design-patterns (resource management).

## Purpose

The schema is plain SQL in `growpico-be/db/migrations/`. There is no migration runner, no ORM and no Atlas. The migration files are the schema truth. Specs describe intent. Where they differ, the file wins, and the difference goes into `docs/DATABASE_SCHEMA_NOTES.md`.

## When to Use

- Adding or changing a table, column, index, constraint or seed row.
- Writing a store function's SQL, or checking which tables and constraints it may rely on.
- Deciding whether a table is real, unused or planned.

## When Not to Use

- Endpoint shapes and error codes: `be-api-contract`.
- Password hashes, token storage rules: `be-security-boundaries` (the rules; the SQL is here).
- Flutter or CMS data: not in this repo.

## Files

| File | Role |
|---|---|
| `db/migrations/20261005_01_initial_schema.sql` | Schema truth. The only migration that exists today. |
| `db/migrations/README.md` | Naming, apply command, rules 1–6. |
| `garden-ai/solutioning/specs/domain/be/DATABASE_DESIGN.md` | Table inventory with `built` / `in schema, unused` / `planned` markers. |
| `growpico-be/docs/DATABASE_SCHEMA_NOTES.md` | Contract → table map (§2), guards (§3), deviations D1–D16 (§4), assumptions A1–A10 (§5). |
| `garden-ai/solutioning/infrastructure/infra-backend/DATABASE_SCHEMA.sql` | **Stale placeholder** (Prisma header, `firebase_uid NOT NULL`). Do not copy. |

## Apply

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/<file>.sql
```

- `DATABASE_URL` must use `sslmode=require` for Aiven. Never commit it.
- Files apply in filename order. Nothing checks `schema_migrations` before applying, so apply each file once by hand.
- Use `pg_dump --schema-only --no-owner` for a snapshot when one is needed. Do not commit a snapshot as a second truth (README).

## Naming and Rules (migrations README)

- Name: `YYYYMMDD_NN_short_description.sql`. `NN` is a two-digit sequence for that day. The README's three examples are illustrations, not planned files (the password-reset one is deferred).
- Rule 1: never edit a file after it has been applied anywhere. Add a new file.
- Rule 2: wrap in `BEGIN; ... COMMIT;` when the file has only transactional DDL. Not for `CREATE INDEX CONCURRENTLY`.
- Rule 3: end every file with `INSERT INTO schema_migrations (filename) VALUES ('<file name>');`.
- Rule 4: prefer additive changes (nullable or defaulted columns, new tables, new indexes).
- Rule 5: destructive changes need a rollback note as a comment at the top.
- Rule 6: test on a throwaway Postgres before Aiven.

## The Initial File

- Not wrapped in a transaction (README exception: it creates an extension and a trigger function). Run it on an empty database.
- Creates `citext`, the `set_updated_at()` trigger function, and 58 tables including `schema_migrations`. `schema_migrations` is created with `CREATE TABLE IF NOT EXISTS` (line 22); every other table uses plain `CREATE TABLE`.
- Seeds `levels` 1–10 (line 1058) and `mastery_tiers` 1–10 (`MED001`–`MED010`, line 1071). Levels 11+ are not seeded (A6). The integration test expects level 1 to be named `Seed Starter`.
- Ends with its own `schema_migrations` row.
- Tested by the notes on `postgres:14.18`. The target is PostgreSQL 16. Test new files on 16.

## Idempotency: What Exists

- **Re-running an applied file fails loudly.** The first plain `CREATE TABLE` errors, and the final `INSERT` fails because `schema_migrations.filename` is the primary key. With `ON_ERROR_STOP=1`, `psql` exits non-zero.
- The only `IF NOT EXISTS` guards in the initial file are `citext` and `schema_migrations`.
- The README does not require `IF NOT EXISTS`. Keep new files transactional (rule 2): a failed file rolls back as a whole, so it is simply fixed and re-run. The exception is a non-transactional file (for example `CREATE INDEX CONCURRENTLY`), which can stop half-way; there, `IF NOT EXISTS` on each object lets the file be re-run.

## Integrity Guards in the Schema (verified in the file)

| Guard | Object |
|---|---|
| Users have unique username and email | `users_username_key`, `users_email_key` (constraint names used by code) |
| One identity per provider id | `user_identities_provider_type_provider_id_key` (name used by code) |
| EMAIL identity must have a password hash | `CHECK (provider_type <> 'EMAIL' OR password_hash IS NOT NULL)` on `user_identities` |
| Refresh token stored as a unique hash | `sessions.refresh_token_hash TEXT NOT NULL UNIQUE`; `rotated_from_id` self-reference |
| Background job enqueued once | `uq_jobs_dedupe` on `jobs (type, dedupe_key)` where the key is not null |
| One active container per device | `uq_containers_device` (not deleted) |
| One running calibration per device | `uq_calibration_one_running` |
| One active growth story per plant | `uq_growth_stories_active` |
| XP granted once per user and entity | `uq_xp_events_ref (user_id, ref_type, ref_id)` |
| A reading is stored once per device | `PRIMARY KEY (device_id, seq)` on `readings` |

Not enforced in SQL: container capacity against plant count, the 500 XP/day cap, the manual-care cap, quota debit. These belong in the transaction in the service.

## Code Depends on These Names

`auth/service.go` matches on `users_username_key`, `users_email_key` and `user_identities_provider_type_provider_id_key`. `account/errors.go` matches on `users_username_key`. Renaming a constraint breaks duplicate handling silently (the error would fall through to `internal_error`). Keep the names, or change the code in the same change.

## Table Status (what the code reads and writes)

| Status | Tables |
|---|---|
| Written and read by code | `users`, `user_identities`, `sessions`, `streaks` (created at register, read by profile) |
| Read by code (DATABASE_DESIGN: "in schema, read by profile") | `levels` (seeded), `containers`, `plants`, `species`. The profile query reads all four. Only tests write `containers`, `species`, `plants` |
| In schema, no code | `devices`, `readings`, `container_environments`, `plant_conditions`, `events`, `calibration_*`, `care_actions`, `plant_score_snapshots`, `xp_events`, missions, quests, learning, growth, AI, notifications |
| Unused by design | `plant_images`, `growth_photos`, `push_tokens`, `ai_*` (no photo storage, no AI, no push in the first release, M2/M3) |
| Admin (no module) | `admin_users`, `admin_sessions`, `audit_logs` |
| Platform | `jobs` (no worker), `idempotency_keys` (no middleware), `schema_migrations` |

## Design Rules (DATABASE_DESIGN §Design rules, present in the file)

- UUID primary keys from `gen_random_uuid()`.
- `TIMESTAMPTZ` for all timestamps.
- Enums are `TEXT` with `CHECK`. The file creates no `CREATE TYPE`.
- `updated_at` maintained by the `set_updated_at()` trigger.
- `jsonb` only for rule-tuned data (care profiles, requirements, score weights) and snapshots.
- Index every foreign key. The spec rule is not yet audited against the migration.
- `users.xp` and `users.level` are caches written only by the XP ledger (not built).

## Known Gaps and Open Schema Questions

- `containers.capacity` is `CHECK 1..5` (A2). The contract says max 3. Contract Q#25 (1 pot = 1 seed) is undecided.
- `plant delete = soft delete` (A3, CONTRACT_GAP #4). Ledger rows still point at plants.
- `readings` has no partitioning (A8). Growth is about 480k rows per day at 10k devices.
- The 6-hour notification merge window is worker logic, not SQL (A10).
- Photo retention has no column (A9).
- `DATABASE_SCHEMA_NOTES.md` §2 says credentials stay in Firebase Auth (1.1–1.5). That is stale: auth is email and password.
- `users.age_gate_confirmed_at` exists but is never set (contract Q#37).

## Procedure: Schema Change

1. Confirm the contract or spec requires it (`be-api-contract`, `DATABASE_DESIGN.md`).
2. Create `db/migrations/YYYYMMDD_NN_<name>.sql`. Header comment: purpose, spec reference, rollback note if destructive.
3. Wrap in `BEGIN; ... COMMIT;` if transactional. Only a non-transactional file (such as `CREATE INDEX CONCURRENTLY`) needs `IF NOT EXISTS` so it can be re-run after a partial apply.
4. Add the final `INSERT INTO schema_migrations (filename) VALUES ('<file name>');`.
5. Apply to a throwaway PostgreSQL 16 after the initial file: `psql ... -v ON_ERROR_STOP=1 -f`. Then run `go test ./...` with `TEST_DATABASE_URL` set (be-architecture §Verification).
6. Update the Go store code in the same change. Keep constraint names the code matches on.
7. Report: file name, tables touched, the spec section, and whether `DATABASE_SCHEMA_NOTES.md` needs a new deviation entry (do not edit specs from code work).
