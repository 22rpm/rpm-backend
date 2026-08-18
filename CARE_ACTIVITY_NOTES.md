# Care Activity & Time Tracking — implementation notes

Companion doc for the clinical-activity / time-tracking build (spec §3.6–3.8,
§4). Part 1 (migrations for `time_entries`, `time_timer_sessions`,
`patient_calls`, `clinical_notes`) is landed on `feature/care-activity-schema`
(branched off `main`). Parts 2–6 (routes/services) are **held** pending review
and landing of `middleware/orgScope.js` on a clean base — these are billing
records and org-scoping must be reviewed before it gates them.

---

## Timer heartbeat rules (authoritative — this defines every billable minute)

These values MUST be repeated in a comment block at the top of the timer service
when Part 3 is built. They live here so the rule is documented outside the code.

- **Heartbeat interval:** client sends a heartbeat every **15 seconds** while the
  timer is running AND the tab is focused/active (not backgrounded, not idle).
- **Maximum gap that still accrues:** **30 seconds** (one missed beat). When a
  heartbeat arrives, the server accrues `min(now − last_heartbeat_at, 30s)` of
  active time. So a single dropped beat still counts (the tab was plausibly
  active); the accrual is capped at 30s so a gap never adds more than one missed
  interval of time.
- **Gap larger than 30s:** accrual **stops at the last heartbeat** — the elapsed
  time beyond 30s is NOT added. The session is moved to **`paused`**; when
  heartbeats resume, accrual restarts from the resume point (again capped per
  beat). Backgrounded/idle time therefore never accrues.
- **Staleness threshold (orphan sweep):** if `now − last_heartbeat_at > 120s`
  (2 minutes) the session is considered **orphaned** (browser closed, crash, no
  explicit stop). The sweep finalizes it into `time_entries` with
  `status = 'incomplete'`, `duration_seconds = accumulated_seconds` (the active
  time accrued up to the last heartbeat), `ended_at` = `last_heartbeat_at`, and
  deletes the session. The row is **flagged for manual confirmation** — it is not
  a trusted billable duration until the staff member confirms it (which writes a
  superseding `complete` row).

Summary of the state machine:
`running` --(heartbeat ≤30s)--> accrue & stay `running`
`running` --(gap >30s)--> `paused` (no accrual for the gap)
`paused`  --(heartbeat)--> accrue from resume, back to `running`
any       --(explicit stop)--> INSERT `complete` time_entry, delete session
any       --(no heartbeat >120s)--> sweep: INSERT `incomplete` time_entry, delete session

Interval/threshold values are the initial policy; if they change, update this
file and the timer-service comment block together.

---

## Correction chains (`supersedes`)

- A correction is a NEW row whose `supersedes` points to the row it replaces.
  `superseded_by` is **not stored** (would require UPDATE-ing the original).
- **Correction of a correction:** chains are linear — `A ← B ← C` (`B.supersedes
  = A`, `C.supersedes = B`). The `UNIQUE(supersedes)` constraint guarantees each
  row is superseded by at most one other, so no forks.
- **Timeline shows only the head** (newest, non-superseded row) of each chain —
  computed with a LEFT JOIN, not `NOT IN (...)`:
  ```sql
  SELECT t.*
  FROM time_entries t
  LEFT JOIN time_entries s ON s.supersedes = t.id
  WHERE s.id IS NULL          -- t is not superseded by anything -> it's the head
  ```
  For `A ← B ← C` this returns only `C`.
- **Full-chain reconstruction for audit:** walk `supersedes` backwards from the
  head (`C.supersedes = B`, `B.supersedes = A`, `A.supersedes = NULL`). Each row
  points to exactly one predecessor, so the entire history is reconstructible.

---

## Known issues / TODOs

### patient_calls.outcome — needs a constrained set (change B)
- Currently `VARCHAR(255)` (`config/migrations/20260817120200_create_patient_calls.js`).
- Free text can't be reported on, and the billing workflow will ask "how many
  calls actually reached the patient." **Before production use**, migrate this to
  a constrained set. **The real category list must be sourced from the lead
  nurse** (e.g. reached / no answer / voicemail / callback requested / …) — do
  not invent the values.

### alerts.user_id VARCHAR vs INT patient_id — timeline join hazard (change C)
- `alerts.user_id` is `VARCHAR(255)`; all new tables use `INT UNSIGNED patient_id`.
- The activity timeline (Part 6) must include alerts for a patient, which means
  joining `alerts.user_id` to an integer `patient_id`. That requires a **CAST**,
  which (a) **cannot use an index** — a full scan of `alerts` — and (b) **silently
  mismatches** any non-numeric `user_id` value (row just doesn't appear).
- Fine at ~12 patients; a problem as the alert table grows toward ~100+ patients.
- **Not fixed in this pass.** Proper fix is a schema migration to normalize
  `alerts.user_id` to `INT UNSIGNED` with an FK to `users(id)` (with a data
  backfill/validation step for any non-numeric values first).

---

## FK on-delete behavior — flag for decision
- `time_entries`, `patient_calls`, `clinical_notes` use `onDelete("RESTRICT")` on
  `patient_id` / `staff_user_id` / `organization_id`: a billing/audit record must
  not be destroyed by deleting a user or org.
- **Interaction:** the existing `admin.controller.deleteUser` hard-deletes users.
  Once a user has any of these records, that hard delete will **fail** with a FK
  constraint error. This is intentional for billing-record integrity, but it
  changes the behavior of the existing delete flow — surfacing it for a decision
  (likely: block/soft-delete users who have clinical-activity history).
