# Patient multi-org membership — design (SCOPE, not built)

**Status:** DESIGN. Nothing built, no migration written. This doc scopes letting ONE
patient record belong to MORE THAN ONE organization (e.g. a PCP practice *and* a dialysis
clinic, both paying customers) instead of today's single `users.organization_id`.
**Date:** 2026-10-01. **Author:** scoped with Ricky.

> **§7 decisions recorded 2026-10-01 (Ricky).** Readings = attributed-to-PCP + dialysis-readable;
> alerts = PCP-paged + both-view; messages = per-org private; org type lives on `organizations`;
> demographics both-editable (with an audit recommendation). These introduce a THIRD visibility
> mode — "attributed + cross-org readable" (§3a) — which the scoping layer cannot express as one
> global rule; it is per-table and, for readings/alerts, per-purpose (read vs bill vs page). Still
> design-only: no code, no migration.

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
- **Clinical, DECIDED (§7.1–7.3, 2026-10-01):** `dev_data`, `alerts`/`alert_assignments`/
  `alert_reads`, `messages` all **gain an `organization_id` column** (stamp the acting/creating
  org going forward; backfill existing rows to the patient's current single org). What differs is
  the *visibility mode* applied to each — see §3a.

## 3a. THREE visibility modes (not two)

The §7 decisions mean visibility is **not** binary shared-vs-per-org. There are **three** modes:

1. **SHARED** — no `organization_id` on the row; any member org sees it. (Demographics/identity.)
2. **PER-ORG PRIVATE** — row carries `organization_id`; visible ONLY to the owning org
   (`WHERE row.organization_id = req.orgScope`). (Notes, labs, time, meds, scheduled calls, rpm
   notes, consents, billing status, notification_log, **messages**.)
3. **ATTRIBUTED + CROSS-ORG READABLE** (new, from §7.1/§7.2) — row carries `organization_id` naming
   the **owning/billing/paging** org, but **any member org may READ it**. Ownership (billing,
   paging) is gated by the row's org; read is gated only by membership. (`dev_data` readings;
   `alerts`.)

**Can the scoping layer express this? Partly — and mode 3 forces per-table/per-purpose handling.**
- The **membership gate** (`scopePatientParam` / `canAccessPatient`, once cut to
  `patient_organizations`) answers "may this caller touch this patient at all." That is the single
  shared primitive and it is necessary for all three modes — but it is **not sufficient** to
  distinguish them.
- The mode is then expressed **per table, and for mode 3 per query PURPOSE**, by whether a query
  appends the row-org filter:
  - **SHARED** → never append a row-org filter (no column exists).
  - **PER-ORG PRIVATE** → append `AND organization_id = req.orgScope` on every access.
  - **ATTRIBUTED + CROSS-ORG READABLE** → **READ paths do NOT append it** (membership is the whole
    gate); **BILLING and PAGING paths DO** (`WHERE organization_id = <owning org>`). The SAME table
    (`dev_data`, `alerts`) therefore uses different filters for different purposes.
- Consequence: **mode 3 cannot be a single global middleware rule.** The middleware gives the
  patient boundary; each table — and for readings/alerts, each *purpose* (read vs bill vs page) —
  chooses its own row-org filter. This is the main complexity the §7 decisions introduce, and it
  is why the leak test (§6) must assert per-*purpose*, not just per-table.

## 4. Per-table shared / per-org / readable decision table

Modes per §3a: **SHARED** / **PRIVATE** (per-org) / **READABLE** (attributed + cross-org readable).

| Table | Class | Mode | Needs schema change? |
|---|---|---|---|
| `users` (demographics) | — | **SHARED** (name/DOB/MRN/contact) | No |
| `patient_profiles` | B | **SHARED** | No |
| `patient_allergies` | B | **SHARED** | No |
| `patient_comm_prefs` | B | **SHARED** | No |
| `devices` | B | **SHARED** (physical device identity) | No |
| `patient_doctor_assignments` | — (no org col) | **PRIVATE** (assignment is per-org) | Decide col add |
| `dev_data` (readings) | B | **READABLE** — own=PCP (bills), dialysis reads (§7.1) | **Yes — add org col** |
| `alerts` / `alert_assignments` / `alert_reads` | B | **READABLE** — route to PCP, both view (§7.2) | **Yes — add org col** |
| `messages` | B | **PRIVATE** — attributed, not cross-org readable (§7.3) | **Yes — add org col** |
| `time_entries`, `patient_calls`, `clinical_notes` | A | **PRIVATE** (already) | No |
| `lab_results` | A | **PRIVATE** (already) | No |
| `patient_medications` | A | **PRIVATE** (already) — **but fix insert, §8** | No |
| `scheduled_calls` | A | **PRIVATE** (already) | No |
| `rpm_notes`, `patient_billing_status` | A | **PRIVATE** (already) | No |
| `patient_consents` | A | **PRIVATE** (consent is given to a specific clinic) | No |
| `notification_log` | A | **PRIVATE** (already) | No |

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

**Stage 1.5 — Class B clinical schema expansion (`dev_data`, `alerts`, `messages`).**
Add `organization_id` to all three; stamp at insert (device→org for readings/alerts = PCP; staff
party's org for messages); backfill existing rows to the patient's current single org. Then apply
the per-mode read changes (§3a):
- **`messages` (PRIVATE):** switch reads to `AND organization_id = req.orgScope`
  (`messageService.js:88-99,259-303`, `staffMessages.service.js:30-77`).
- **`dev_data` / `alerts` (READABLE):** **drop** the `users`-join org filter on read/list paths
  (`alert.route.js:1959-2379`, reading reads) so membership alone gates viewing; **add**
  `organization_id = <owning PCP org>` on the **billing** path (`billingSummary.service.js:38`
  reading counts) and the **paging** path (`deviceData.service.js:916,984` alert fan-out).
Class A needs none of this.
*Verify:* with single-org patients, every affected read/bill/page path returns identical results
before vs after (the backfilled org equals the patient's only org, so all three modes collapse to
today's behavior). Only once that parity holds is a second membership allowed (Stage 2).

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

**The gating test (CI, standing, blocks Stage 2)** must assert per *mode* and, for READABLE, per
*purpose*. Seed a patient with active memberships in a PCP org and a dialysis org; create one row of
every patient-linked type, plus the Class B clinical trio (`dev_data` reading, resulting `alert`,
`message`). Then assert:
- **PRIVATE (notes, labs, time, meds, scheduled calls, rpm notes, consents, `messages`):** a row
  created by the PCP org is invisible to a dialysis-scoped viewer and vice versa; demographics are
  visible to both. (Mirror both directions.)
- **READABLE (`dev_data`, `alerts`):** a PCP-owned reading/alert **IS readable** by the dialysis-
  scoped clinical view (membership gate), **but** the dialysis org's **billing summary shows ZERO**
  RPM reading count for it, and **paging** targets only the PCP org. This read-yes / bill-no /
  page-PCP split is the subtle assertion mode 3 demands.
- **SHARED:** demographics visible to both; a MRN/DOB edit by one org is visible to the other (and,
  per §7.5, audited).
Plus a static check: PRIVATE reads filter on the row's own `organization_id` (never a `users`
join); READABLE *billing/paging* paths filter on the row's org while READABLE *read* paths do not.

**What breaks if we get it wrong:** (a) cross-org PHI leak — a dialysis clinic sees PCP notes/labs/
readings or vice versa (HIPAA minimum-necessary violation); (b) over-restriction — a `users`-join
query returns nothing because the patient's single `users.organization_id` is now one of two.
(a) is the dangerous one and is concentrated in the Class B clinical tables.

## 7. DECISIONS (recorded 2026-10-01, Ricky)

### 7.1 `dev_data` (readings) — ATTRIBUTED + CROSS-ORG READABLE
**Decision:** PCP bills RPM; dialysis clinics do NOT. Readings are **attributed to the creating
org** (add `organization_id` to `dev_data`), and dialysis member orgs get **READ access** — they
can view readings but not bill them. (Mode 3, §3a.)
**Schema:** add `organization_id` to `dev_data`; stamp at ingest from the device→org path; backfill
existing rows to the patient's current single org. (This is the one high-volume Class B table that
grows a column — plan the backfill and the index on `(user_id, organization_id, created_at)`.)
**Billing cohort queries:** `billingSummary.service.js:38` (and any RPM reading-count) must count
**only readings whose `dev_data.organization_id` = the billing org**, not all of the patient's
readings. Today the cohort is `WHERE users.organization_id = ?`; under this decision a reading's
billability follows the READING's org, not the patient's membership. A dialysis org running a
billing summary must get ZERO RPM reading counts for a shared patient even though it can read those
readings in the clinical view — read path and billing path diverge (see §3a mode 3).

### 7.2 `alerts` — ROUTED to PCP, VISIBLE to both (ATTRIBUTED + CROSS-ORG READABLE)
**Decision:** PCP gets paged; dialysis can view the data. Alerts are **routed/owned by the PCP org**
but **readable by any member org**. (Mode 3.)
**Schema:** add `organization_id` to `alerts` (= the owning/paging org, i.e. the reading's org per
§7.1, which is PCP). `alert_assignments` (paging targets) continue to resolve within the owning
(PCP) org; `alert_reads` follow the reader. **Paging path** filters `alerts.organization_id = PCP`;
**read/list path** is gated by membership only (dialysis sees the alert). The existing alert
queries that derive org via `JOIN users p ... WHERE p.organization_id = ?`
(`alert.route.js:1959-2379`, `deviceData.service.js:916,984`) split accordingly: list/view drop the
users-join org filter (membership gate suffices); fan-out/paging use the new `alerts.organization_id`.

### 7.3 `messages` — PER-ORG PRIVATE (decided; my call)
**Decision: PRIVATE, not cross-org readable.** Unlike readings/alerts — which are clinical
*observations* both care teams legitimately benefit from — a message thread is **relationship-
specific correspondence** between one care team and the patient. A dialysis nurse's exchange with
the patient is not clinical data the PCP needs, and exposing it is gratuitous PHI spread that could
also surface content meant for a single relationship. So `messages` gets an `organization_id` (the
staff party's org) and is visible ONLY to that org (mode 2). This honors the original PHI-exposure
concern and is deliberately stricter than readings/alerts.
**Schema:** add `organization_id` to `messages`; stamp from the staff party's org at save
(`messageService.saveMessage`); backfill to the patient's current org. `getThread`
(`messageService.js:88-99`), inbox (`staffMessages.service.js:30-77`) and unread all add
`AND organization_id = req.orgScope`.

### 7.4 `relationship` lives on the ORGANIZATION, not the membership
**Decision:** an org is either a PCP practice or a dialysis clinic, never both. The type belongs on
`organizations`, not on the join.
**Schema changes:** (a) add `type` (enum `pcp` | `dialysis`, extensible) to `organizations`;
(b) **drop `relationship` from `patient_organizations`** — the join becomes
`(patient_user_id, organization_id, is_active, added_at, added_by)` with `UNIQUE(patient_user_id,
organization_id)`. (c) The "who bills / who pages" rules key off `organizations.type` (PCP bills RPM
and is the alert owner, §7.1/§7.2) rather than a per-membership relationship. (d) Stage-0 backfill no
longer needs to choose a per-membership relationship — it just inserts membership rows; each org's
`type` is set once on `organizations`. **Simpler schema and simpler backfill.**

### 7.5 Shared demographics — both orgs may edit (with a recommendation)
**Decision:** both member orgs may edit shared demographics (`users` / `patient_profiles`).
**Recommendation (NOT a blocking decision):** **audit every demographic edit** — who changed which
field, when — even though both can edit. **Concern on record:** MRN and DOB are exactly what Practice
Fusion patient matching depends on (`PRACTICE_FUSION_FHIR_DESIGN.md` §10 — identifier search by MRN,
DOB-verified). A silent edit by one org to MRN or DOB can **break the other org's chart link** to the
PF record (and any future Observation/labs pull). So at minimum these fields' changes should be
audited and, ideally, surfaced to both orgs; whether to additionally *restrict* MRN/DOB edits is left
open. Recorded as a recommendation to revisit, not a gate on Stage 2.

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
