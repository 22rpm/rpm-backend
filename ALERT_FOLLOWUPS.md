# Alert routing follow-ups

## 1. BP auto-alerts were paging EVERY clinician in the org, for EVERY patient — LIVE defect, now fixed

**What was happening (in production behavior terms):** the BP auto-alert
recipient resolution (`services/deviceData.service.js`, the `clinicianRows`
block ~:903) joined a table named **`patient_doctor`** to find the patient's
assigned clinician. **That table does not exist** (`ERROR 1146` — the real,
authoritative table is `patient_doctor_assignments`). The JOIN was wrapped in a
`try/catch`, and the catch fell back to **"all active clinicians in the patient's
org."** So the assignment branch **never executed** — every BP alert paged
(socket + Twilio SMS) **every active clinician in the org**, not the assigned
physician. A caught error masked the bug for its entire lifetime.

**Found:** 2026-08-28, while reconciling what looked like two assignment tables
(`patient_doctor` vs `patient_doctor_assignments`) for the role-model work. There
were never two tables — one real table and one phantom reference.

**Confirmed live in production (2026-08-28):** prod has **only**
`patient_doctor_assignments` (38 rows) and **no `patient_doctor` table** — so
prod fails the JOIN and falls back org-wide, identical to dev. There is **no
environment split**: the org-wide over-paging has been happening in production
since this code was written. It has been invisible only because there is one org
with effectively one active clinician (paging "everyone" == paging that one
person). It would have become obvious the instant a second physician was added —
a new physician paged for every patient in the org, including patients they don't
manage — which erodes trust in alerts fast.

**Fix (this change):** point the JOIN at `patient_doctor_assignments`, so a BP
alert pages the patient's **assigned physician**. The empty-assignment case (a
patient with no assigned physician — the ORG_CONTEXT #6 orphan class) now falls
through to org-wide **deliberately** (not silently to zero recipients): assigned
→ else org clinicians → else all active clinicians. A safety alert always reaches
someone.

**Behavior change to communicate BEFORE deploy (Kinza) — this is real, not
theoretical:** today, prod pages *every active clinician in the org* for *every*
patient's BP alert. After this deploy, a BP alert pages only the patient's
**assigned physician** (unassigned patients still page the org). Concretely for
her: (1) the clinician who currently sees every alert will, after deploy, see
alerts only for their own assigned patients — if anyone has been relying on
seeing all alerts, that changes; (2) once a second physician is added, each
physician sees only their patients' alerts, which is the intended behavior but a
visible difference from "everyone sees everything" today; (3) org-wide monitoring
of all alerts becomes the care_manager's job via read-only visibility (role-model
step 5), not by paging everyone. Tell her before she notices alerts got quieter,
not after.

**Related — RESOLVED for reads (role-model step 5):** `alert_assignments.doctor_id`
still conflates "can read this alert" with "is an SMS/paging target". Org-staff
(care_manager/admin) visibility is now granted via **org-scoped read queries** on
`/alerts/my-alerts`, `/alerts/unread-count` and `/alerts/my-alerts/unread` — no
assignment row is inserted, so an org-wide reader never becomes a paging target
(asserted in testing: reading created zero `alert_assignments` rows). The
underlying column still conflates the two axes; splitting it is a schema change
and is NOT done.

**RESOLVED — read-state for org-wide readers (`alert_reads`).** Read state now
lives in its own table (`alert_reads(alert_id, user_id, read_at)`, migration
`20260831130000`), keyed UNIQUE per person per alert so marking read is
idempotent. Org-wide readers get their own inbox: `read_status`/`read_at` in the
org-wide list responses are now THIS reader's state, and the assigned
clinician's state is still exposed alongside under `assigned_read_status` /
`assigned_read_at` rather than being silently presented as the reader's own.
`PATCH /:alert_id/read` and `/mark-all-read` write to `alert_reads` for org-wide
roles — **never** to `alert_assignments`, so marking read still cannot make
anyone a paging target. Mark-read is org-scoped (404 for an out-of-scope alert,
matching the rest of the surface). The clinician flow is untouched and still
uses `alert_assignments`; verified that a care_manager clearing their inbox does
not clear the clinician's. Existing `alert_assignments.read_status` values were
deliberately NOT backfilled into `alert_reads` — they record that the *assigned
clinician* read something, and copying them would invent read events.

**Was open before that change:** `read_status` /
`read_at` live on `alert_assignments`, i.e. per assigned clinician. An org-wide
reader has no assignment row, so:
- `PATCH /alerts/:alert_id/read` returns **404** for them (no row to update);
- `PATCH /alerts/mark-all-read` is a **silent no-op** (`UPDATE ... WHERE
  doctor_id = <them>` matches nothing);
- the `read_status` they see in a list is *some assigned clinician's* read state,
  not their own.

These write paths were deliberately left alone: the only way to make them work
with today's schema is to insert an `alert_assignments` row, which is precisely
what would page the reader. Per-reader read state needs its own table (e.g.
`alert_reads(alert_id, user_id, read_at)`) — a schema decision, not a route fix.

**Also open:** the org-wide read still JOINs `alert_assignments`, so an alert with
**no** assignment row is invisible to everyone, org-wide roles included. After the
routing fix above every alert should get at least one row (assigned → org
clinicians → all active), but an org with zero active clinicians would produce
orphan alerts that nobody can see.

## 2. The all_clinicians socket gate was dead since written — FIXED (b650a03), with a correction to the "new pushes" framing

The socket set `socket.userRole = decoded.role`, but tokens carry `role_type`
(issueSession) — so `userRole` was always undefined and the
`if (userRole === 'clinician') join('all_clinicians')` gate NEVER fired. The
`new_alert_broadcast` channel (which emits to `all_clinicians`) therefore reached
no one for its entire lifetime.

**Correction to "realtime alert delivery never worked":** it did — via a
*different* channel. The dashboard listens to BOTH `new_alert` (per-user) and
`new_alert_broadcast` (all_clinicians). The per-user `new_alert` is emitted to
`user_<doctor_id>` rooms, which every user joins on connect regardless of role —
so connected recipients HAVE received realtime alerts. What never worked is only
the all_clinicians BROADCAST channel.

**Net user-facing change (for Kinza) — narrower, not new:** with the assignment
reconciliation (#1), per-user recipients went from org-wide (every org clinician
got a realtime `new_alert`) to the assigned physician. And the all_clinicians
broadcast channel — dead anyway — is now removed. So a clinician will receive
FEWER realtime pushes: only for their assigned patients, not every patient in the
org. This reinforces the paging message in #1 (realtime AND SMS both narrow to
the assigned physician); it is NOT clinicians suddenly getting pushes they never
had. The socket gate is now correct (clinicians join, care_manager/admin do not),
but `all_clinicians` has no emitters, so activating it changes nothing on its own.

## 3. Org-wide alerts list duplicated every alert by its recipient count — read-side fan-out, FIXED

The Alerts page for org-wide roles (super-admin / admin / care_manager) showed each
alert once PER RECIPIENT. `GET /alerts/my-alerts` org-wide branch
(`routes/alert.route.js`, ~2455) drove `FROM alert_assignments JOIN alerts` with no
`DISTINCT`/`GROUP BY alerts.id`, so an alert paged to N clinicians returned N identical
rows. The badge and the list counted DIFFERENT things: badge = `COUNT(DISTINCT a.id)`
(correct), list = one row per assignment (inflated).

Measured on prod (2026-09-09, reader = user 1, an org-wide role):
- `badge_distinct_unread` = 65, `distinct_alerts_total` = 65, `list_rows_returned` = 321.
- 321 / 65 = 4.94 ≈ recipients per alert. e.g. alert_id 90 = ONE alert, 5 assignments
  (recipients 7,12,16,24,31), rendering as 5 identical "110/53" rows for patient Maria Unwalla.

Fix: drive the query `FROM alerts`, LEFT JOIN assignments, `GROUP BY alerts.id`, and
aggregate recipients — `recipient_count`, `recipient_ids`, `recipient_names`,
`recipients_read_count`. One row per alert; the org-wide viewer still sees who it paged.
The reader's own read state stays per-reader via `alert_reads`. The clinician-scoped
branch (~2521, `WHERE alert_assignments.doctor_id = ?`) was CORRECT and untouched — a
clinician has one assignment per alert, so it never fanned out.

FRONTEND CONTRACT: the org-wide list response dropped the ambiguous per-assignment fields
(`assigned_read_status`, `assigned_read_at`, `assignment_id`, single `doctor_id`) and added
the aggregated recipient fields. The org-wide alerts UI must read `recipient_count` /
`recipient_names` for "who it went to" (count, or names on expand) instead of a single
doctor. "Mark read" for org-wide already writes `alert_reads` (per-reader), so it is
unaffected.

## 4. PROCESS NOTE — we nearly deleted clinical data to fix a problem that didn't exist

The duplicate alerts LOOKED like duplicate reading writes. A full design was drafted for a
DB-level idempotency migration on `dev_data` — including a phase that **DELETEs duplicate
rows** (clinical BP readings) to make room for a unique index. Before building it, we ran
the data check: `dev_data` had exactly ONE duplicate reading in the entire table (user 15,
117/82, Aug 23 — a single retry), and the logged-in reader's own assignments were ZERO. The
real cause was read-side fan-out (#3), not duplicate writes. The migration would have
deleted real clinical rows to fix a problem that wasn't there.

Pattern to keep: **check the data before building the fix.** A symptom that reads as
"duplicates on screen" has at least three distinct causes — duplicate writes, per-recipient
fan-out, or a badge/list counting mismatch — and they need opposite fixes. One `COUNT`/
`GROUP BY ... HAVING COUNT(*)>1` query distinguished them in seconds and saved a destructive,
irreversible migration. Idempotency on the write path is still worth doing as defense-in-
depth (that one real dupe proves it can happen, and the iOS history-sync leans on a server
dedup that does not exist) — but on its own merits, not as a fix for this bug.

## 5. Severity mislabel FIXED (labeling only); thresholds still have NO clinical owner

**The bug:** `determineTypeForClinician` returned `"high"` for ANY extreme band —
including extreme *low* — so 110/53 (diastolic < 60) was labeled `type: "high"` and the
dashboard badge (`capitalize(alert.type)`) rendered it as **"High"**. A clinician read
"severity: high — 110/53" as high blood pressure. That's a clinical-safety mislabel
independent of what the numbers should be.

**The fix (labeling only, thresholds UNCHANGED):** split into two orthogonal axes —
- **direction** (`high` = hypertension, `low` = hypotension, `divergent`) → stored in
  `alerts.type` (the axis the dashboard badge + filter already use), so a low reading now
  renders as **"Low"**, never "High".
- **urgency** (`critical` = an extreme band, `warning` = a moderate band) → carried in the
  human-readable `desc`, e.g. `"Low BP (110/53) — critical"`. Also on the socket payload
  (`urgency`) and the clinician SMS.

The band boundaries are byte-for-byte the SAME as before — this changed labels, not
thresholds. Frontend needs no change to stop the mislabel (`type` stays high/low). Renamed
`determineTypeForClinician` → `determineBpSeverity`; `type` values gained `divergent`.

**⚠️ Thresholds have never had clinical review — and that predates this work.** BOTH
threshold sets currently running in prod were written without a physician:
- the alert GATE `calculateBPStatus` (`>=140/>=90` High, `<90/<60` Low), and
- the severity BANDS in `determineBpSeverity` (extreme `>140` / `<90` / `>99` / `<60`,
  moderate `130-140` / `90-99` / `60-69`).

They disagree with each other (e.g. the gate has no crisis level; the bands call `<60`
diastolic "extreme/critical", which is why 110/53 is urgency=critical). Whether `<60` is
critical, where the hypertension bands sit, and whether to add a `>=180/>=120` crisis tier
are **physician-level clinical decisions**. There is no medical director on the project.
Kinza is lead nurse and the closest we have, but this is above nurse scope. **Until someone
owns the numbers: thresholds stay as-is, and wiring per-clinician `doctor_alert_settings`
(still queried, still ignored) is deferred.** This note is the standing flag that the
production thresholds are unvalidated.
