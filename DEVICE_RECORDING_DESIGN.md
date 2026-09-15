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

## Day-count (CPT rule now confirmed — see BILLING_FOLLOWUPS #18)
CMS-1734-F settles the axis this started on: **99454/99445 is once per patient per 30 days, NOT per
device** — so the note's single per-patient count is CORRECT on that axis and must NOT become
per-device. The real defect is narrower: the count is device-agnostic over raw `dev_data`
(`rpmNote.service:139`), so it counts days from devices that aren't ordered/recorded/supported (e.g.
Gracie's spo2), which CMS's ordered + reasonable-and-necessary requirement says shouldn't count.

**Sequencing dependency this surfaces:** the fully-correct fix (count only the patient's RECORDED
devices) would zero every count until the backfill, so it can't strictly precede it. The order is:
(1) **interim** day-count fix = restrict to `is_active` device types (drops spo2, needs no
`patient_devices`), → (2) backfill, → (3) tighten to recorded-device-only. Two CMS-ambiguous points
(16-day cross-device aggregation; device-to-condition relevance) need Cleo/Kinza before the code
lands. Full detail + citations: **BILLING_FOLLOWUPS #18**.

## `dev_data` stores the same measurement under divergent JSON keys (ingest inconsistency)
Surfaced 2026-09-15: the RPM note showed Heart Rate blank for a BP2A patient while BP displayed
fine. Root cause was NOT the note — it was that a BP reading's pulse lands under **different keys
depending on the ingest path**:
- `$.pulse` — raw from the BP2A (viatom) device (32 of 117 bp rows locally)
- `$.bpm` — the normalized shape (`deviceData.service.js` / `patient.service.js` write
  `bpm: data.pulse || data.heartRate || 0`) (85 rows)
- `$.heartRate` — a third raw key the read-side code defends against (`data.pulse || data.heartRate`
  across `doctor.service.js`, `messageController.js`); 0 rows locally but possible from some device.

No row carries more than one key. The note read only `$.bpm`, so BP2A-only months were all-NULL.
**Fixed on the read side** (`rpmNote.service` HR now `COALESCE($.pulse,$.heartRate,$.bpm)`; commit
`7d21859`), matching how every other service reads it. But the read-side coalesce is a workaround for
a **write-side inconsistency**: one ingest path normalizes to `bpm`, another stores the raw device
payload verbatim. Open items:
- **Audit the other vitals for the same key drift** — if pulse diverges, `systolic`/`diastolic`,
  spo2, glucose, weight likely do too across the raw-vs-normalized paths. A blank vital on a signed
  note is a silent record defect (the note is meant to BE the record), so this is worth a sweep.
- **Decide on one normalized shape at ingest** so reads don't each have to know every device's raw
  key. Until then, every new query over `dev_data` must coalesce the same way — easy to forget.

## Vitals key-drift audit (2026-09-15) — the gap is bigger than pulse
Ran after the HR fix, on the hypothesis "if pulse was under the wrong key, the other vitals are
too." What the audit actually found:

**Write side stores the client payload VERBATIM — no normalization.** `deviceData.service.js`
(ingest, ~line 858) writes `JSON.stringify({ ...deviceData })` — only adding `bpStatus` for bp.
So the JSON keys in `dev_data.data` are whatever the client app / device SDK sent, and they have
drifted across app versions. The `bpm: data.pulse || data.heartRate` normalization exists only on
scattered READ paths (`patient.service`, `doctor.service`, `messageController`), never at write.

**Observed `dev_data` shapes (local, `bp` only — no spo2/glucose/weight rows exist locally):**
- `bpStatus, bpm, diastolic, result, systolic` (85 rows) — older/normalized shape (`bpm`)
- `bpStatus, diastolic, mean, pulse, systolic` (32 rows) — raw BP2A/viatom shape (`pulse`, `mean`)

Per-vital verdict:
- **systolic / diastolic** — SAME key in both shapes → BP always displayed correctly. No drift.
- **pulse/heart rate** — `bpm` vs `pulse` (and `heartRate` defended against elsewhere) → drift;
  **fixed** by the read-side `COALESCE($.pulse,$.heartRate,$.bpm)` (commit `7d21859`).
- **mean arterial pressure** — raw writes `mean`; read code elsewhere looks for `meanPressure`/`map`.
  Drift exists, but the NOTE does not use MAP, so no note impact.

**The bigger finding — the note computes ONLY blood pressure.** `rpmNote.service` runs a single
vitals query on `dev_type = 'bp'` and returns a `vitals` object with only `bp_systolic`,
`bp_diastolic`, `heart_rate`, `reading_count`. But the template (RpmNote.jsx AND the PDF) renders
rows for **Blood Glucose, Weight, and O2 Saturation** that read `v.blood_glucose` / `v.weight` /
`v.o2_saturation` — fields the service NEVER sets. So those three rows are **unconditionally blank
on every note, for every patient**, regardless of data. This is not key drift — it is a missing
computation. No impact TODAY (only `bp` is an active device type and only bp data exists), but:
- Gracie (id 10, prod) has transmitted spo2. The moment spo2/glucose/weight go active, the note
  will silently omit real, transmitted vitals — a signed-record defect, exactly the failure mode
  that motivated this audit.
- When those vitals ARE wired into the note, the query must COALESCE the raw client keys the same
  way pulse now does, because the write side stores them unnormalized and the key is client-defined
  (determine the real keys from the client app / production data, not the backend — the backend
  never sees a normalized shape).

**Recommended follow-ups (not built here):**
1. Add spo2/glucose/weight to the note's vitals computation (with per-key COALESCE) when those
   device types are activated — OR hide those template rows until they're computed, so the note
   never shows a vital it isn't actually reading.
2. Normalize device payloads to ONE shape at ingest, so every read path stops re-guessing keys.
3. A migration/backfill to normalize historical `dev_data` keys is optional; the read-side coalesce
   covers reads in the meantime.

### Known record gap — Maria's signed September note has a blank heart rate
Maria's September RPM note was **signed while this bug was live**: her September readings came from
the BP2A (`$.pulse`), the note read only `$.bpm`, so the frozen snapshot captured an all-NULL heart
rate even though pulse WAS transmitted and is in `dev_data`. The note is an append-only, hashed,
signed record — **signed is signed, so it stands as filed** (regenerating it would break the hash;
it faithfully reflects what the system computed at signing). But the blank HR is a KNOWN,
explained gap, recorded here so anyone reading that note later knows the heart rate was blank due to
the `$.pulse`/`$.bpm` key mismatch (fixed 2026-09-15, commit `7d21859`) — NOT because pulse was
missing. If a corrected note is ever wanted, signing a correction (which supersedes) would
re-compute and capture HR; that is a clinician decision, not an automatic backfill.
