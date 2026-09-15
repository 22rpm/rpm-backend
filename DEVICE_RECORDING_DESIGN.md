# Device recording — design (SCOPE, not built)

**Status:** SCOPE. Billing-adjacent (`patient_devices` backs the device-supply codes 99453/99454/
99445), so request and commit are separate steps and the billing pieces get a reviewer.
**Date:** 2026-09-14.

## The finding — `patient_devices` has never been populated, for anyone
A query for enrolled/active patients who transmit but have **no active `patient_devices` row**
returned **all 16 transmitting patients** — Maria included, at 89 transmission days. The field is
wired end to end (enrollment writes it; `rpmNote.service` reads it; the note renders the
"Device(s) Provided" boxes from it) but **has simply never been filled**. Consequence: **every RPM
note ever generated has shown "No active device on record" with every box unchecked**, on a form
that supports 99454/99445. This is not a fringe gap for a few patients — it is a field nobody has
ever populated.

Root cause: `device_type` is **optional** in `EnrollPatientModal` (`if (form.device_type)`), the
only place a `patient_devices` row is written. There is **no post-enrollment UI** to add one
(the edit form has no device section; Device Management is a read-only telemetry view of
`devices-used` from `dev_data`).

## Remediation — three parts, in this build order
1. **Day-count billing fix FIRST** (see §"Day-count"). Don't record devices against a count that
   computes the wrong thing.
2. **Required at enrollment, with a "device pending" state** (§"Enrollment").
3. **Edit-form device section** (§"Edit-form scope") — recurrence + corrections + device-later.
4. **Backfill** the 16 existing patients (SQL, done as part of the profile pass) — after 1.

## Enrollment — required, never optional-blank
Make `device_type` **required** at enrollment (an enrolled patient with no device can't legitimately
support device-supply codes). But do **not** block the legitimate "enroll now, device ships later"
workflow: instead of a silent blank, offer an explicit **"device pending"** choice that records the
intent (e.g., a `patient_devices` row with `status='pending'`, or a marked no-device-yet state that
the note surfaces as "device pending" rather than "no device on record"). The invariant: a
billing-active patient either has an active device row or an explicit pending marker — never an
unexplained empty.

## Edit-form device section — scope
Same gating as the existing patient-edit writes (`authRequired` + `requireRole(...)` clinical
staff/admin + `resolveOrgScope` + `scopePatientParam` so the target patient is in the caller's org).

**Backend (`rpm-backend`):**
- `GET /api/patients/:id/devices` — active + retired devices for the form.
- `POST /api/patients/:id/devices` — add `{device_type, serial_number?, assigned_at?}`. Validate
  `device_type` is `is_active=1` (reuse the enrollment check, `patientEnrollment.service:141`); INSERT
  mirroring the enrollment path exactly (`patient_id`, `organization_id` from the patient,
  `device_type`, `serial_number`, `assigned_at`, `assigned_by=actor`, `status='active'`,
  `patientEnrollment.service:275`).
- `PATCH /api/patients/:id/devices/:deviceId` — retire (`status='inactive'`) / replace (retire old +
  POST new).
- **Audit** each add/retire (new `audit.service` ACTIONS `DEVICE_ASSIGN` / `DEVICE_RETIRE`) — device
  records back device-supply billing, so provenance matters (the SECURITY_FOLLOWUPS #17 lesson).

**Frontend (`rpm-dashboard`, `EditPatientModal`):**
- A **Devices** section: current active device(s) with serial + assigned date; "Add device" (dropdown
  of active `device_types`, serial, date); retire/replace. Same modal save flow + gating as the rest
  of the edit form.

**Related, fast follow (not v1):** the note's "Device education completed" box comes from
`rpm_device_setups` (99453), which enrollment also writes. Recording a device and its education are
linked — v1 scopes `patient_devices` only; a "device education completed (99453)" control writing
`rpm_device_setups` follows.

**Out of scope, deliberately:** no inference of provided devices from transmissions. The box must
assert a **recorded fact** — auto-checking it from `dev_data` on a signed note would assert something
nobody recorded, on a form that supports device-supply billing.

## Inactive / unrecorded transmitted device type (the Gracie case, id 10 — spo2 + bp)
Behavior verified in code:
- **Ingest accepts any `dev_type`** — `dev_data.dev_type` is a free string, not validated against
  `device_types` (no FK, no allow-list). SpO2 readings store fine.
- **Not surfaced in the note** — `rpmNote.service` computes only BP vitals (no `o2_saturation`
  computation), so spo2 never appears; the O2 row renders blank.
- **The UI can't record it** — enrollment offers/validates `device_types WHERE is_active=1` (only
  `bp`). The `patient_devices` FK *would* accept `spo2` (the key exists, just `is_active=false`), so
  a direct/SQL insert works; the UI won't.
- **Billing seam** → see §"Day-count" + BILLING_FOLLOWUPS.

## Day-count (the fix that goes first)
The transmission-day count that sets the device-supply band is **device-agnostic**:
`SELECT DISTINCT day FROM dev_data WHERE user_id=? AND <month>` — no `dev_type` filter
(`rpmNote.service:139`). Whether that is CORRECT depends on the CPT 99454 multiple-device rule
(per-device vs once-per-patient-aggregated), which is being confirmed against CMS/AMA before the fix
is written. The corrected behavior + the CPT citation are recorded in **BILLING_FOLLOWUPS** (the
day-count entry); this section will point to it once settled. Do not implement the day-count change
until that entry lands.
