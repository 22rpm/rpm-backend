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

## Patient worklist / enrollment schema notes (migrations 20260818*)

### CPT 99453 episode assumption — changing it is a MIGRATION, not a column add
- `rpm_device_setups` enforces one 99453 per patient per device type via
  `UNIQUE(patient_id, device_type)`. This assumes **one lifelong RPM episode per
  patient**.
- If discharge/re-enroll **episodes** are ever modeled, 99453 becomes billable
  again for a new episode. Supporting that requires adding `episode_id` to
  `rpm_device_setups` **and to the unique key** — i.e. a schema migration that
  rewrites the unique constraint, not just a nullable column add. Written here so
  it's findable rather than remembered.

### device_type keys are UNVERIFIED except 'bp' — confirm before non-BP enrollment
- `device_types` is a lookup (chosen over ENUM and over VARCHAR+app-constraint):
  adding a type is a data `INSERT`, it keeps FK integrity, and `dev_data_type`
  holds the verified mapping to what the device actually sends.
- Only **`bp`** is verified against real `dev_data` traffic (`SELECT DISTINCT
  dev_type FROM dev_data` returns only `'bp'`) and is seeded `is_active = 1`,
  `dev_data_type = 'bp'`.
- `glucose`, `spo2`, `weight`, `peak_flow`, `temperature` are seeded
  `is_active = 0`, `dev_data_type = NULL`. **The vendor's actual `dev_type`
  strings for these are unknown.** Before enrolling a patient on anything other
  than a BP cuff: capture real traffic from that device, set `dev_data_type` to
  the confirmed string, and flip `is_active = 1`. The enrollment form must offer
  only `is_active = 1` types.

## Known issues / TODOs

### GET /api/care/time-entries should filter by month server-side (Part 2 / billing)
- Billable time is billed per calendar month (CPT 99457/99458). The activity UI's
  billable counter must show the current month only, but the GET endpoints return
  the full head-of-chain history with no date filter, so the frontend currently
  filters by `started_at` **client-side**.
- Fine at ~12 patients; wrong at 100 (pulls an unbounded history to the client to
  sum one month).
- **Fix direction:** `GET /api/care/patients/:patientId/time-entries` should accept
  `?month=YYYY-MM` (or `?from=&to=`) and filter on `started_at` server-side. The
  `(patient_id, started_at)` index already supports the range scan.

### Corrections don't record who made them (Part 2 + Part 4)
- A correction writes a superseding row in `time_entries` (Part 2) **and in
  `patient_calls`** (Part 4 call corrections). In both, `staff_user_id` is
  **preserved from the original** (correct for billing attribution — the clinical
  time/call belongs to whoever did the work), but there is **no `corrected_by`**:
  the identity of the person who made the correction is not stored anywhere on
  the row.
- For a billing record this is an audit gap — "someone changed this from 12 to
  15 minutes" with no name is exactly what an auditor would flag. The same gap
  applies to a call whose outcome/reason/note was corrected.
- **Fix direction:** add a `corrected_by` column (INT UNSIGNED FK -> users) set to
  `req.user.id` on correction rows in **both** tables, OR write an `audit_log`
  entry per correction (services/audit.service.js). The audit_log route keeps the
  schemas unchanged and matches the §4 "retain change/audit records" principle; a
  column keeps it queryable inline. Decide before this ships as a billing source.
- Clinical notes (Part 5) will have the same property — corrections preserve the
  original author and don't record the corrector — so fold notes in when this is
  addressed.

### Time attribution: WHO logged the minutes — RESOLVED (role-model step 5)
- **Done.** The note now carries `time_documentation.by_actor` (per staff member:
  name, role, `kind`, minutes) plus `provider_minutes` and
  `clinical_staff_minutes` roll-ups, rendered as a "Time by staff member" table
  above the signature block. `kind` is `provider` when the actor's role is
  `clinician`, `clinical_staff` otherwise. Actors are keyed by `staff_user_id`,
  so two staff sharing a display name never merge.
- Two new entries appear in the note's `missing` flags: unattributed time (a row
  whose `staff_user_id` no longer resolves) and a standing note when any
  clinical-staff minutes are present, prompting confirmation that the supervision
  arrangement supports billing them.
- **Supervision is now recorded at write time**, not inferred at render time:
  `time_entries.supervising_provider_id` (migration `20260831120000`), resolved
  on insert from the patient's single assigned clinician, NULL when the actor is
  themselves a clinician (performed personally) or when the patient has no single
  assignment (we do not guess). Corrections **carry the link forward** from the
  row they supersede rather than re-resolving, so a later reassignment cannot
  rewrite who supervised historical work.
- Existing rows were deliberately **not backfilled** — NULL means "not recorded",
  which is true; backfilling from today's assignment would manufacture a
  supervision claim nobody made.
- **Still open:** the attestation wording above the signature says "personally
  performed or *directly* supervised". See `ATTESTATION_REVIEW_FOR_ROSEMARY.md` —
  flagged for compliance, deliberately unchanged.

### (superseded) original write-up of the gap
- `time_entries.staff_user_id` records the actor correctly. But
  `services/rpmNote.service.js` aggregates the month's time with **no reference to
  it** — the query selects `activity_category`, a day bucket and
  `duration_seconds` only.
- So the generated note shows `Provider: <assigned clinician>`, then
  undifferentiated minute totals (Setup/Education, Data Review + Interaction,
  Total), then a physician signature block. **A care manager's minutes are
  presented indistinguishably from the physician's own**, under the physician's
  attestation.
- Why it matters: the 99457/99458 family contemplates clinical-staff time
  delivered under the billing practitioner's supervision as a distinct thing from
  the practitioner's own time. A note that silently merges them misstates who
  performed the work — exactly what an auditor reads the note to determine.
  Confirm the billing requirement with the biller/compliance before choosing a
  shape; the code position is what is documented here.
- **Fix direction (no schema change needed for the minimum):** the actor is
  already on the row, so the note service can `JOIN users` + `role` on
  `staff_user_id` and split the TIME DOCUMENTATION buckets by role — e.g.
  "Clinical staff time (under supervision): N min" vs "Physician/QHP time:
  N min", with the supervising provider named. What IS missing is any recorded
  supervision link: `patient_consents` has `supervising_provider_id`, but
  `time_entries` has no equivalent, so "under whose supervision" would be
  inferred from `patient_doctor_assignments` rather than recorded at the time the
  work was done. If that inference is not acceptable for billing, a
  `supervising_provider_id` column on `time_entries` is the durable fix.
- Related: the note is generatable by care_manager/admin but **only a clinician
  may sign it** (`RpmNote.jsx` — "Only a clinician (physician/QHP) may sign this
  note"). That guard is correct and unchanged; it is also why the merged totals
  matter — the signature attests to the whole document.

### Correction response `time_entry` field can be a carried-forward entry (Part 4 API note)
- On a call correction with **no time change**, the response's `time_entry` is the
  **carried-forward** entry (the existing linked row), NOT a newly created one.
  The field name reads like "the entry I just created," which it isn't in that
  case. Frontend should treat `time_entry` as "the entry currently linked to this
  call," and must not assume a correction always produced a new ledger row.

### patient_calls.outcome — constrained set SHIPPED (was: BLOCKS BILLING ENGINE)
- **Done.** Six canonical outcomes in `config/callOutcomes.js` (confirmed with the
  lead nurse): `Reached patient`, `Reached caregiver`, `No answer`,
  `Left voicemail`, `Wrong or disconnected number`, `Patient declined`. Only the
  first two satisfy CPT 99457 test (b) (`QUALIFYING_OUTCOMES`). Enforced by a
  CASE-SENSITIVE CHECK constraint (migration `20260823120000`); existing rows
  normalised by that migration (bare "reached" → NULL with the original preserved
  in `note`, since it doesn't say who was reached).
- **The frontend lagged the migration** (the failure this brief fixed): the
  call-logging form was still a free-text `<input>`, so a nurse either got a 400
  (typed free text the CHECK rejects) or saved NULL (left blank) — and a NULL
  outcome means 99457 silently doesn't bill. Fixed: `CareForms.jsx` `LogCallForm`
  is now a required `<select>` populated from `enrollment-options`.
- **`enrollment-options` now serves general FORM LOOKUPS**, not only enrollment —
  it returns `call_outcomes` alongside payers/device types/clinicians so the six
  values live in ONE file across both repos. The endpoint name under-describes it;
  kept deliberately rather than renamed.
- **Server-side NULL gap is still OPEN** (scoped out of the form change): the API
  and the CHECK both still permit NULL, so "must pick one" holds only in the
  browser. See `BILLING_FOLLOWUPS.md` §9 for what closing it involves and the
  existing-NULL-row decision.

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
