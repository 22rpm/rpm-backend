# Four-role model — status and verification record

Roles: `super-admin`, `admin`, `care_manager`, `clinician` (plus `patient`).

**The one rule:** `super-admin` / `admin` / `care_manager` are **org-wide** — they
see any patient in their organization. `clinician` is **assignment-scoped** — only
patients in `patient_doctor_assignments`. Defined once in
`services/patientAccess.js`; nothing else may redefine it.

**Visibility is not responsibility.** Being able to SEE a patient or an alert
never makes someone a paging/SMS target. Routing stays assignment-based
(`alert_assignments`, message `receiverId`). Never grant visibility by inserting
assignment rows — that would page the reader. See the header block in
`services/patientAccess.js` and `ALERT_FOLLOWUPS.md` #1.

---

## Step status

| Step | What | State |
|---|---|---|
| 1–2 | Session token carries `role_type` + `org_id` | done (`3a15ab9`, SECURITY_FOLLOWUPS #9) |
| 3 | Register `care_manager` (Joi allow-list, dedup ranking) | done (`a87c731`) |
| 4 | Patient visibility — shared `patientAccess` helper across 6 gates | done (`5ce7acf`…`81fa5bc`) |
| 5 | Alert visibility for org-wide roles + per-reader read state | done (`abbf63d`, `75e99a8`, this change) |

Step 5 covered three things: org-scoped alert **visibility** for org-wide roles;
per-actor **time attribution** on the RPM note, with the supervision link
recorded in the ledger at write time; and per-reader **read state**
(`alert_reads`) so an org-wide reader has their own inbox without being enrolled
as a paging target.

---

## Verification record

Recorded deliberately so nothing here gets assumed later.

### Step 4 — patient visibility

| Claim | How verified |
|---|---|
| Org admin can view patient data under *Switch to Clinical* | **device-verified** (Ricky, on-device) |
| Clinician scope unchanged (assignment-only) | **device-verified** (Ricky, on-device) |
| Cross-org denial | **programmatically verified** — see below |

Cross-org was previously code-verified only, because dev had just one live
organization (org 3 is `is_deleted = 1`). It has since been exercised against a
seeded second org and a `care_manager` in it, over HTTP with real tokens:

- `GET /doctor/patients/:id/vital-signs` → **404** for an other-org care_manager
  (200 for same-org). 404 not 403 is deliberate — it does not confirm the
  patient exists (`middleware/orgScope.js`).
- `GET /doctor/patients/:id/device-data` → **404** other-org, 200 same-org.
- `GET /doctor/assigned` and `/doctor/search-patients` → **0 rows** other-org,
  7 same-org.
- Passing `?organizationId=<victim org>` as an other-org care_manager → still
  **0 rows**. `resolveOrgScope` ignores client-supplied org for non-super-admins.

**Nuance worth keeping in mind:** `canAccessPatient(user, orgScope, patientId)`
verifies that the *patient* belongs to `orgScope`; it does **not** validate
`orgScope` itself. Called with a spoofed `orgScope` it returns true. That is by
design — `resolveOrgScope` is what makes `orgScope` trustworthy — but it means
the helper is only self-sufficient about the *patient* side of the boundary. A
future caller that computes `orgScope` from anything other than
`resolveOrgScope` would break the guarantee.

### Step 5 — alert visibility

Verified the same way (seeded second org + care_manager, real tokens):

- `/alerts/my-alerts`, `/alerts/unread-count`, `/alerts/my-alerts/unread` →
  same-org care_manager 200 with the org's alerts; other-org care_manager 200
  with **0 rows**.
- **Clinician scope unchanged, discriminating test:** with an org alert assigned
  to a *different* clinician, the clinician under test saw **2** (their assigned
  rows) while the care_manager saw **3** (the whole org). An earlier version of
  this check was weak — assigned count happened to equal the org total — so it
  could not have detected a regression. Seed the discriminating case if
  re-running.
- **Reading creates no `alert_assignments` rows** (asserted before/after). An
  org-wide reader never becomes a paging target.

### Step 5 — per-reader read state (`alert_reads`)

Verified on dev with a seeded care_manager and the existing clinician:

- care_manager starts with every org alert unread (their own state, not the
  assigned clinician's), can mark one read (**200**, previously 404), and their
  count drops by one.
- Marking read is **idempotent** — re-marking is a no-op and leaves exactly one
  `alert_reads` row.
- **Zero `alert_assignments` rows** are created by any of it, before or after
  mark-all-read. Visibility still never implies paging.
- Cross-org: another org's care_manager marking the same alert gets **404** and
  writes no read row.
- The clinician's inbox is **not** cleared when the care_manager clears theirs.

### Not verified

- **No automated test suite.** `npm test` is still the placeholder. The checks
  above were run from throwaway scripts against the dev DB and deleted; they are
  not guarding anything. Re-verification is manual until they are made permanent.
- **Nothing here has been exercised against production data or a real second
  production organization** — prod has one org today.
- `admin` (non-super-admin) alert visibility is widened by the same change but
  was only exercised via `care_manager`; both take the identical `isOrgWide`
  branch, so this is code-verified, not separately executed.

---

## Open design question — actor attribution on the RPM note

**Today the note does not distinguish who logged billable time.**

- `time_entries.staff_user_id` records the actor correctly, and it is the right
  column — "the clinical time belongs to whoever did the work"
  (`CARE_ACTIVITY_NOTES.md`).
- But `services/rpmNote.service.js` aggregates time with **no reference to
  `staff_user_id`** — the query selects only `activity_category`, a day bucket
  and `duration_seconds`.
- The note therefore renders `Provider: <assigned clinician>` at the top, three
  undifferentiated minute totals in TIME DOCUMENTATION, and a physician
  signature block at the bottom. Care-manager minutes are indistinguishable
  from the physician's own.

If a care manager's time is to be billed as clinical-staff time under the
billing provider's supervision, the note needs to say so. See the "Time
attribution" entry in `CARE_ACTIVITY_NOTES.md` for the shape of the fix. Decide
before this note is used as a billing artifact.
