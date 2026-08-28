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

**Environment split:** on dev (`rpm_db_v1`) `patient_doctor` is absent, so the
fallback always fired (org-wide). If a `patient_doctor` table ever existed on
prod, alert routing there would have differed from dev — one reason the fix also
makes behavior deterministic. (Prod existence check was requested; see the query
in the reconciliation report.)

**Fix (this change):** point the JOIN at `patient_doctor_assignments`, so a BP
alert pages the patient's **assigned physician**. The empty-assignment case (a
patient with no assigned physician — the ORG_CONTEXT #6 orphan class) now falls
through to org-wide **deliberately** (not silently to zero recipients): assigned
→ else org clinicians → else all active clinicians. A safety alert always reaches
someone.

**Behavior change to communicate BEFORE deploy (Kinza):** whoever currently
receives a page for *every* patient in the org will stop receiving pages for
patients they are not assigned to. Alerts will get quieter for them by design —
tell her before she notices, not after.

**Related, not fixed here:** `alert_assignments.doctor_id` still conflates "can
read this alert" with "is an SMS/paging target"; org-staff (care_manager)
visibility must be granted via org-scoped read queries, never by inserting
assignment rows (that would page them). Tracked in the role-model work, step 5.
