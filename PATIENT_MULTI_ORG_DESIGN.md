# Patient multi-org membership — design (SCOPE, not built)

**Status:** DESIGN. Nothing built, no migration written. This doc scopes letting ONE
patient record belong to MORE THAN ONE organization (e.g. a PCP practice *and* a dialysis
clinic, both paying customers) instead of today's single `users.organization_id`.
**Date:** 2026-10-01. **Author:** scoped with Ricky.

> **Blocking decisions below (§7) need Ricky's sign-off before any build.** The `dev_data`
> (readings) decision in particular drives the schema and the staging, so settle it first.

---

## 1. Problem & today's model

Today a patient is exactly one row in `users` with a single `organization_id`. All patient
access flows from that scalar:
- `resolveOrgScope` resolves the **caller's** one org into `req.orgScope`.
- `scopePatientParam` (`middleware/orgScope.js:137-145`) gates a route by
  `SELECT organization_id FROM users WHERE id=? → === req.orgScope`.
- `canAccessPatient` (`services/patientAccess.js:51-57`) re-checks the same equality, then
  applies the role/assignment layer.

We need a patient to be reachable by two paying orgs as **one record** (no duplicate charts),
each org seeing its own clinical data plus shared demographics — **not** each other's clinical
data by default.

## 2. The model

**Two layers.**
- **Layer 1 — MEMBERSHIP** (new `patient_organizations` join): "may org X touch this patient at
  all, and see shared demographics." Replaces the `users.organization_id` equality in the two
  gates with a membership test.
- **Layer 2 — ROW VISIBILITY**: a patient-linked data row is visible to a caller only when the
  row's owning org == `req.orgScope`. Org A sees what A created; org B sees what B created.

**Proposed `patient_organizations`** (mirrors the existing `biller_organizations` user↔org
many-to-many precedent, `middleware/orgScope.js:62-90`):

| column | notes |
|---|---|
| `patient_user_id` | FK → `users.id` (INT UNSIGNED — the verified FK-target type) |
| `organization_id` | FK → `organizations.id` |
| `relationship` | pcp / dialysis / rpm — **but see open decision §7.4** |
| `is_active` | soft membership toggle |
| `added_at` | timestamp |
| `added_by` | FK → `users.id` (acting staff) |

`UNIQUE(patient_user_id, organization_id)`. Idempotent migration + `information_schema` FK guard
+ guarded `down()`, per the house pattern.

## 3. The core structural fact — two classes of patient-linked table

**Layer 2 is "free" for some tables and real schema work for others.** (Verified against
migrations, 2026-09-30.)

- **Class A — already carry `organization_id`**, stamped at INSERT (almost always from
  `req.orgScope`, the acting org): `time_entries`, `time_timer_sessions`, `patient_calls`,
  `clinical_notes`, `patient_devices`, `patient_consents`, `rpm_device_setups`,
  `patient_billing_status`, `rpm_notes`, `patient_medications`, `scheduled_calls`,
  `notification_log`, `lab_results`, `audit_log`. **Per-org visibility is already enforceable** —
  reads filter on the row's own org. No schema change.
- **Class B — NO `organization_id`**; org is derived at read time via a JOIN to
  `users.organization_id`: `alerts`, `alert_assignments`, `alert_reads`, `messages`,
  **`dev_data` (the actual BP/vitals readings)**, `devices`, `patient_profiles`,
  `patient_allergies`, `patient_comm_prefs`. For a multi-org patient there is **nothing to filter
  on**, so without a decision both orgs would see all of these.

**Class B splits cleanly:**
- **Correctly SHARED (leave as-is):** `patient_profiles`, `patient_allergies`,
  `patient_comm_prefs`, `devices` — these ARE the shared demographics/identity layer.
- **Clinical, NEEDS A DECISION (§7.1–7.3):** `dev_data`, `alerts`/`alert_assignments`/
  `alert_reads`, `messages`. Each must either **gain an `organization_id` column** (stamp the
  acting org going forward; backfill existing rows to the patient's current single org) **or** be
  consciously declared **shared** across the patient's orgs.

## 4. Per-table shared / per-org decision table

| Table | Class | Proposed treatment | Needs schema change? |
|---|---|---|---|
| `users` (demographics) | — | **Shared** (name/DOB/MRN/contact) | No |
| `patient_profiles` | B | **Shared** | No |
| `patient_allergies` | B | **Shared** | No |
| `patient_comm_prefs` | B | **Shared** | No |
| `devices` | B | **Shared** (physical device identity) | No |
| `patient_doctor_assignments` | — (no org col) | **Per-org** (see §7, assignment semantics) | Decide |
| `dev_data` (readings) | B | **OPEN — §7.1** | Yes, if attributed |
| `alerts` / `alert_assignments` / `alert_reads` | B | **OPEN — §7.2** | Yes, if attributed |
| `messages` | B | **Recommend attribute — §7.3** | Yes, if attributed |
| `time_entries`, `patient_calls`, `clinical_notes` | A | Per-org (already) | No |
| `lab_results` | A | Per-org (already) | No |
| `patient_medications` | A | Per-org (already) — **but fix insert, §8** | No |
| `scheduled_calls` | A | Per-org (already) | No |
| `rpm_notes`, `patient_billing_status` | A | Per-org (already) | No |
| `patient_consents` | A | Per-org (consent is given to a specific clinic) | No |
| `notification_log` | A | Per-org (already) | No |

## 5. Staged migration path (no big-bang on a live clinical system)

Each stage ships independently, is reversible, and is verified before the next. The real feature
(a second membership) stays dark until Stage 2's isolation tests pass.

**Stage 0 — add + backfill + dual-write, ZERO read changes.**
Create `patient_organizations`; backfill one `is_active` row per existing patient from
`users.organization_id` (relationship per §7.4 default); dual-write new memberships wherever a
patient's org is set today (enrollment `patientEnrollment.service.js:180`, user create
`user.service.js:55`). All reads still use `users.organization_id`.
*Verify:* reconciliation query — every patient has exactly ONE active membership equal to
`users.organization_id`. Purely additive; safe to deploy.

**Stage 1 — cut MEMBERSHIP checks over, single-membership so behavior is identical.**
Change `scopePatientParam` (`orgScope.js:137`) and `canAccessPatient` (`patientAccess.js:51`) from
the `users.organization_id` equality to
`EXISTS (patient_organizations WHERE patient_user_id=? AND organization_id=req.orgScope AND is_active=1)`.
Backfill guarantees exactly one membership == the old column, so every decision is byte-identical.
*Verify:* shadow/diff — run BOTH the old equality and the new EXISTS in a canary and assert they
agree across a patient sample and a wrong-org sample, before the flip. **Second memberships are NOT
allowed yet.**

**Stage 1.5 — Class B clinical schema expansion (only the tables §7.1–7.3 say to attribute).**
Add `organization_id` to `dev_data` / `alerts` / `messages` as decided; stamp it at insert from
the acting org; backfill existing rows to the patient's current single org; switch their reads from
the `users`-join (`alert.route.js:1959-2379`, `staffMessages.service.js:30-77`,
`messageService.js:259-303`) to the row's own column. Class A needs none of this.
*Verify:* with single-org patients, each affected read returns identical results before vs after
(the backfilled org equals the patient's only org).

**Stage 2 — enable the feature (second org) + confirm isolation.**
Allow adding a patient to a second org (admin endpoint/UI). Now memberships pass for BOTH orgs;
Layer-2 row filters keep each org's clinical data separate.
*Verify (gating):* the cross-org isolation test (§6) must be green — including Class B clinical —
before second memberships are enabled in prod.

**Stage 3 — retire `users.organization_id` for patients (last).**
Stop reading it for patient scoping (done by Stage 2), then stop writing it for patients. **It
cannot be dropped from the table** — staff still use it — so it is retired *semantically for
patients only*.
*Verify:* grep shows no patient-scoping read of it; an integration test with a patient's
`users.organization_id` set NULL still passes (nothing reads it).

## 6. Access model & the leak test

**Default: NO cross-org clinical sharing.** Membership (Layer 1) grants demographics + the right to
create/see *your own* clinical rows; row visibility (Layer 2) keeps clinical data partitioned by
owning org. Enforceable at the scoping layer for Class A and for Class B *once attributed*; the
shared-vs-per-org call is per-table (§4).

**The gating test (CI, standing, blocks Stage 2):** seed a patient with active memberships in org A
and org B; create one row of EVERY patient-linked type stamped org B — **including a `dev_data`
reading, its resulting `alert`, and a `message`** (the Class B clinical trio, where a leak is most
likely), plus the Class A types. Authenticated as an org-A user AND as a super-admin scoped to A,
hit every patient-data read endpoint and assert: **none** of org B's rows appear, and shared
demographics **do**. Mirror it (org-A data vs org-B viewer). Plus a static check that every
patient-linked read filters on the row's own `organization_id`, never a `users` join.

**What breaks if we get it wrong:** (a) cross-org PHI leak — a dialysis clinic sees PCP notes/labs/
readings or vice versa (HIPAA minimum-necessary violation); (b) over-restriction — a `users`-join
query returns nothing because the patient's single `users.organization_id` is now one of two.
(a) is the dangerous one and is concentrated in the Class B clinical tables.

## 7. OPEN DECISIONS — need Ricky's answer before build

### 7.1 `dev_data` (readings) — attribute to creating org, or shared?
**Driver:** if BOTH a dialysis clinic and a PCP practice bill RPM for the same patient, each must
bill its OWN readings, which requires attributing every reading to the org that captured it → add
`organization_id` to `dev_data`. **"Shared" means only ONE org can bill that patient for RPM** —
there is no per-org reading count to substantiate two separate 99454-type claims, and both orgs
would see all readings. This is the decision that drives the schema and Stage 1.5; settle it first.
- *Attribute:* add the column, stamp at ingest from the device→org path, backfill historical rows
  to the patient's current org. Enables dual-org RPM billing; more work.
- *Shared:* no schema change; only one org bills; both orgs see all vitals (may be clinically fine,
  but forecloses dual RPM billing).

### 7.2 `alerts` — attributed or shared?
**Patient-safety angle:** alerts fire from readings and drive paging. For a dual-org patient, **who
gets paged?** If readings are attributed (§7.1), alerts should be too, so the dialysis team is paged
for dialysis-captured readings and PCP for PCP-captured — not both for everything (alert fatigue), and
not the wrong team (missed escalation). If alerts are shared, both orgs' on-call see every alert.
Alerts/`alert_assignments`/`alert_reads` carry no org today (`alert.route.js:1959-2379`), so
attributing means a schema add on all three. **Recommend this track §7.1 — readings and their alerts
should be attributed or shared together**, not split.

### 7.3 `messages` — attribute (RECOMMENDATION, pending decision)
**Recommendation: ATTRIBUTE.** A cross-org-visible message thread is a PHI exposure — a dialysis
clinician reading the PCP↔patient thread (and vice versa). `messages` has no org column and
`getThread` is not even org-scoped today (it relies on `canAccessPatient`), so once membership is
multi-org the full thread would be visible to both orgs. Attributing (stamp the staff party's org;
backfill to the patient's current org) keeps each org's correspondence to itself. Pending your
confirmation.

### 7.4 `relationship` on the membership vs a `type` on the organization
Is "pcp / dialysis / rpm" a property of the **membership** (this patient↔this org) or of the **org
itself**? A dialysis clinic is *always* a dialysis clinic → the type belongs on `organizations`, and
the join needs no `relationship`. It only belongs on the join if the SAME org can be one patient's
PCP and another patient's dialysis. This changes the schema (drop `relationship` from the join vs
keep it). Need your answer; also sets the Stage-0 backfill default (what relationship to assign
existing single-org memberships).

### 7.5 Who may EDIT shared demographics?
`users`/`patient_profiles` (name, DOB, MRN, contact) are shared across member orgs. If BOTH orgs can
edit them, one clinic silently changes the other's view, and MRN edits could break the Practice
Fusion mapping. Options: restrict edits to an owning/PCP org; or allow both but audit every change
(append-only). Need a rule before Stage 2.

## 8. Defect to fix REGARDLESS of multi-org

**`medication.service.js:404-417` (staff-created meds) and `:159-172` (self-report) stamp the
patient's `users.organization_id` onto the created row instead of `req.orgScope` (the acting org).**
Every other Class A insert correctly uses `req.orgScope` (timeEntry, clinicalNote, labResults,
scheduledCall, callDoc, rpmNoteSign, notification_log, consents). This is **wrong today** — it's just
invisible while one patient = one org, because the two values coincide. It becomes a mis-attribution
(and a billing/visibility bug) the instant a patient is multi-org. **Fix it now, independent of this
project:** stamp `req.orgScope` like the other inserts. Small, self-contained, and it removes one
Class A exception from the multi-org surface.

## 9. Staff multi-org — OUT OF SCOPE (patients only)

A clinician working at both clinics is a **different, bigger problem** and is NOT needed for this
goal. `resolveOrgScope` gives non-super-admin/biller users a single `req.user.org_id` from the JWT
with no per-request org selection, so a dual-clinic clinician can't "switch hats." Solving it means a
`staff_organizations` table AND giving clinicians the org-selection mechanism only super-admin/biller
have. **Deferred.** Interim: a dual-clinic clinician uses two accounts, or the clinics collaborate via
`care_manager`/assignment. (`patient_doctor_assignments` is already org-agnostic — see §7, assignment
semantics for a dual-org patient.)

## 10. Notes / flags carried from scoping

- **Super-admin & biller org-selection already fits multi-org** — they scope to A or B per request
  and see that slice; the dashboard clinic picker extends with no change.
- **Frontends + iOS need their own audit** (separate from this backend doc): what a patient in two
  orgs sees in the patient app, and that the dashboard shows only the selected clinic's slice.
- **`biller_organizations` is the precedent** for the join-table shape and the per-request selection
  UX — mirror it.
