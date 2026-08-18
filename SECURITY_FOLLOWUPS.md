# Security follow-ups (backend)

Tracked, NOT fixed on `hotfix/admin-routes-missing-auth`. Recorded during the
privilege-escalation fix for the admin user-mutation and care-team routes.

## 1. `role.user_id` needs a UNIQUE constraint
- `role.user_id` is indexed `MUL`, not `UNIQUE`, so a user can accumulate
  multiple role rows.
- **This is not hypothetical — it triggers on the next role change.**
  `services/admin.service.js:144` `updateUserRole` runs
  `INSERT ... ON DUPLICATE KEY UPDATE role_type = ...` (`:148`). With no unique
  key on `user_id`, the `ON DUPLICATE KEY` branch can never fire, so it will
  **silently INSERT a second role row** the first time anyone changes a user's
  role, rather than updating the existing one.
- **Fix:** add `UNIQUE(role.user_id)` (one role per user) via migration, after a
  data check/backfill to collapse any pre-existing duplicates. Current DB state:
  5 role rows / 5 distinct users / 0 duplicates (clean today).

## 2. `getUserRoleType` should resolve most-privileged-wins, not newest-wins
- `controllers/admin.controller.js:16` `getUserRoleType` currently takes the
  most recent role row (`ORDER BY id DESC LIMIT 1`).
- Combined with #1, this is a security hazard for
  `blockedSuperAdminTarget` (`controllers/admin.controller.js:28`): if a
  super-admin ever gets a newer `admin` role row, "newest wins" returns `admin`,
  so the guard stops treating them as a super-admin and a plain admin could
  modify/delete/reset-password the super-admin account. A stale/newer lower-priv
  row must not be able to defeat the guard.
- **Fix:** resolve the effective role as the **highest-privilege** role among the
  user's rows (super-admin > admin > clinician > patient), not the newest.
- **Left as-is for now** (per decision) — safe only because #1 hasn't triggered
  yet; fix #1 and #2 together.
