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

**Still open after step 5 — read-state for org-wide readers.** `read_status` /
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
