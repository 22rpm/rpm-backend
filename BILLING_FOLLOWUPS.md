# RPM billing / claim follow-ups

Tracked, not all built. The RPM note computes CPT eligibility and dates of
service, but a submittable claim needs more than this system currently models.

## 1. ICD-10 diagnosis code — REQUIRED on every claim, NOT modelled — OPEN
`patient_conditions` stores free-text names ("Hypertension"), not codes (I10).
Deferred by Ricky (he'll add it later). Until then **the note is NOT a
submittable claim on its own** — the biller adds the diagnosis code. The note now
says so explicitly (`compliance_checks`); do not let any UI imply otherwise.

**Schema to build (approved shape — code alongside name + lookup):**
- `patient_conditions`: add `icd10_code VARCHAR(10) NULL`. Keep `name` for
  display; `icd10_code` is the claim value and source of truth. One code per
  condition row (add rows for multiple diagnoses).
- Reference table `icd10_codes (code VARCHAR(10) PK, description VARCHAR(255),
  is_common_rpm TINYINT(1) DEFAULT 0)`, seeded with common RPM diagnoses (I10
  essential hypertension, E11.9 T2DM, I50.x heart failure, N18.x CKD, …). Powers
  a typeahead so staff pick a validated code instead of free-typing.
- Enrollment/edit form: condition entry becomes {name, code-from-lookup}.
- Note/claim: surface the code(s); once present, drop the "not a submittable
  claim" line from `compliance_checks`.

## 2. No-conflicting-codes check — OUTSIDE this system — OPEN (manual)
2026 claim guidance requires confirming no overlapping RTM or Home Health codes
were billed for the same period. We have no visibility into that. The note flags
it as a manual check (`compliance_checks`) rather than implying verification.

## 3. Place of Service — REQUIRED on claims, NOT modelled — OPEN
11 (Office) vs 02/10 (Telehealth).

**Schema to build (approved shape — org default + per-patient override, resolved
and frozen at signing):**
- `organizations.default_place_of_service VARCHAR(2) NULL` (the practice model,
  usually `"11"`).
- `patient_profiles.place_of_service VARCHAR(2) NULL` — per-patient override
  (e.g. a telehealth patient `"02"`/`"10"`).
- Constrained set `{11, 02, 10}` (Office / Telehealth-other / Telehealth-home).
- The RPM note resolves `patient override ?? org default` and **freezes the
  resolved value in the signed `rpm_notes` snapshot** (so the claim reflects what
  was true at signing). Effective value is per-claim; staff don't re-pick monthly.

## 4. Provider NPI — REQUIRED on claims, NOT stored anywhere — OPEN
Not on `users`. Must live somewhere and appear on the note.

**Schema to build (approved shape — individual profile + group NPI):**
- `user_provider_profiles (user_id INT PK/FK→users ON DELETE RESTRICT,
  npi VARCHAR(10), credential VARCHAR(20) NULL, taxonomy VARCHAR(20) NULL,
  license_number VARCHAR(50) NULL)` — the individual (type-1) NPI per clinician.
- `organizations.billing_npi VARCHAR(10) NULL` — the group (type-2) NPI when
  billed under the group.
- The note shows the billing provider's NPI (biller confirms individual vs
  group) and freezes it in the signed snapshot.
- **Also resolves the `rpm_notes.signed_credential` GAP:** `credential` here
  (MD/NP/RN) is the missing professional credential the signed note wants — once
  this table exists, signing populates `rpm_notes.signed_credential` from it
  instead of leaving it NULL.

## 5. 99470 interactive-communication requirement — PENDING biller
99457 confirmed requires a live interactive communication (test b). Whether 99470
does too is unconfirmed. Configured to REQUIRE it by default (conservative) in
`config/rpmBillingRules.js` (`interactiveRequirement.appliesTo` includes 99470).
Drop 99470 from that list if the biller says it's time-only.

## 6. Date of service on the note itself — PENDING biller
The system computes a PER-CODE date of service ("date the threshold was met").
The note shows a single primary date; the biller confirms which code's date
should appear on the note. All per-code dates are in the endpoint's `billing`.

## 7. Reimbursement display — deliberately OFF
National-average amounts are in config (`reimbursement`, `display:false`). §3.9
keeps revenue separate from eligibility — nothing surfaces estimated revenue yet.
Vary by locality; confirm local values before ever displaying.
