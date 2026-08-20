# Migration follow-ups (backend)

Recorded during the migration-directory reconciliation (Aug 2026). Parallel
feature branches each authored and ran their own knex migrations against the
shared dev DB but were never merged into one lineage, so no single branch's
`config/migrations` matched what `rpm_db_v1` had actually applied and
`migrate:latest` failed with "the migration directory is corrupt, the following
files are missing." That is now fixed: `main` carries the full applied set of 45
migration files (see `chore/migration-reconcile`), the replay was verified
against an empty scratch schema, and `rpm_db_v1`'s bookkeeping was made honest.
The items below are the residual cleanups surfaced along the way — NOT yet done.

## 1. Duplicate `alert_assignments` read-status migration — OPEN
- Two near-identical files both add a read-status column to `alert_assignments`:
  - `config/migrations/20251001062836_add_read_status_to_alert_assignments.js`
  - `config/migrations/20251001062942_add_read_status_to_alert_assignments.js`
  The timestamps (…62836 and …62942) show the generator was run twice. Both are
  in the applied set on `rpm_db_v1`.
- During the reconciliation replay, `…062942` raised knex's **"migration did not
  return a promise"** warning — its `up()` isn't returned/awaited. It still
  applied without a schema defect (the scratch-vs-`rpm_db_v1` schema diff was
  clean apart from unrelated redundant FK-backing indexes), so this is latent,
  not breaking.
- **To do:** reconcile the two into one — make its `up()`/`down()` return the
  knex builder, confirm the column definition matches what's on the DB, and
  retire the redundant file THROUGH the reconciliation flow (never delete a file
  that's recorded in `knex_migrations` without it).

## 2. Stale `rpm_db` database — OPEN (decide: drop)
- The local MySQL server has three RPM-ish databases:
  - `rpm_db_v1` — the real dev DB (`.env` `DB_NAME=rpm_db_v1`), 45 applied
    migrations, holds the test data.
  - `rpm_db_reconcile` — throwaway scratch schema, created/dropped on demand for
    replay verification (see the `scratch` env in `knexfile.js`).
  - `rpm_db` — **stale**: has tables (e.g. `users`) but `knex_migrations` is
    empty (0 rows), i.e. untracked. `main`'s `development` block used to hardcode
    `database: "rpm_db"`; that literal is now fixed to read `process.env.DB_NAME`,
    but the stale database itself still exists and is a footgun (someone runs
    migrate/seed against it, or trusts its data).
- **To do:** confirm nothing depends on `rpm_db` (it carries no migration
  history — almost certainly a pre-`_v1` leftover) and `DROP DATABASE rpm_db`.

## Verifying migrations before a real run
`knexfile.js` has a `scratch` env pointing at a throwaway `rpm_db_reconcile`
schema. Before any production migration: create the empty schema, run
`npx knex migrate:latest --env scratch`, `mysqldump --no-data` diff it against
the target DB, then drop it. This is the technique that proved the MRN migration
actually executes; use it again before prod (which has no snapshots/backups).
