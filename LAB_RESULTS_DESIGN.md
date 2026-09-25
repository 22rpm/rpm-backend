# Lab results — design

**Status:** Increment 1 BUILDING (2026-09-25). **Author:** scoped with Ricky.

**Goal.** Import lab results into the platform and show them on the patient chart. The
ingestion source must be **swappable** — API (lab-provider or Greenway FHIR), file import,
or manual entry — and the storage + display must work identically regardless. Lab-provider
API integrations come later (Ricky is doing provider outreach); increment 1 ships **manual
entry** so storage + display are proven end-to-end with zero external dependency.

## Does the in-progress Greenway/Practice Fusion FHIR integration already cover labs?
Not as scoped — the requested token scope is `system/Encounter.read system/Patient.read`
only (see PRACTICE_FUSION_FHIR_DESIGN.md). But lab results in FHIR are `Observation`
(category=laboratory) and `DiagnosticReport`, and **`Observation` is on Greenway's exposed
system-scope list**; on a (g)(10)-certified API the USCDI **Laboratory** class must be
reachable. So the **cheapest path — IF the results live in the practice's Greenway chart —
is a scope-add** (`system/Observation.read`, plus `system/DiagnosticReport.read` if exposed)
on the SAME app + signing key, plus a FHIR→`lab_results` mapper. **Caveat that decides the
whole thing:** Greenway is the **primary-care** EHR. **Renal/dialysis panels often originate
at the dialysis provider or a reference lab and are NOT filed into the PCP's chart** — so a
Greenway scope-add may cover *some* patients and **miss the ones that matter most** (the
renal/dialysis population this platform serves). That is a question for the Greenway
follow-up (PRACTICE_FUSION_FHIR_DESIGN.md §"Future scope — Lab results"): verify per-patient
whether the needed labs actually appear in the Greenway chart before betting on it. Labs that
live only at Quest/LabCorp/the dialysis provider need a direct integration regardless.

Either way, **storage + display are source-neutral** (below), so this decision does not block
increment 1 and no work here is wasted whichever path a provider lands on.

## Existing DB state (verified 2026-09-25)
- **No lab tables, no LOINC anywhere** — greenfield.
- `dev_data` is device readings only (`dev_id`, JSON `data`, `dev_type` bp/spo2/…). Labs are a
  different domain (source, cadence, fields) and are **not** shoehorned into it.
- `patient_profiles` has no lab columns.
- There is an ICD-10 reference table (`icd10cm_codes`) but **no LOINC equivalent**.
  `icd10cm_codes` (code PK + descriptions + search index, public data, no PHI) is the
  **template** for a future `loinc_codes` table — not built now.

## Data model — `lab_results` (its own table)
One row per resulted analyte. Append-only with a **correction chain** (`supersedes`), exactly
like `time_entries`: a correction is a new row pointing at the row it replaces; the head of a
chain is the row nothing supersedes (LEFT JOIN, not NOT IN). Types match FK targets —
`users.id` and `organizations.id` are both `increments` = **INT UNSIGNED** (verified).

- `id` bigIncrements PK
- `patient_id` INT UNSIGNED NOT NULL → FK users.id (CASCADE)
- `organization_id` INT UNSIGNED NOT NULL → FK organizations.id (org scope; every read filters it)
- `test_name` VARCHAR(120) NOT NULL — human label ("Potassium"); always present, works with no code
- `loinc_code` VARCHAR(20) NULL — coding OPTIONAL now (LOINC table is a later increment)
- `value_text` VARCHAR(255) NOT NULL — result **as reported** (numeric "5.2", qualitative "Positive", "<0.5")
- `value_num` DECIMAL(14,4) NULL — parsed numeric when available (trending); null for qualitative
- `unit` VARCHAR(40) NULL
- `reference_range` VARCHAR(120) NULL — **text** ("3.5-5.1"); ranges vary by lab/age/sex
- `abnormal_flag` ENUM(normal, low, high, critical_low, critical_high, abnormal) NULL — **as the lab reports it**, never computed here
- `collected_at` TIMESTAMP NULL — specimen collection (the clinically meaningful date)
- `resulted_at` TIMESTAMP NULL — when finalized
- `resulting_lab` VARCHAR(120) NULL — Quest / LabCorp / dialysis provider
- `source` ENUM(api, file, manual) NOT NULL — the **swappable-ingestion key**; every path writes a row with its source
- `source_ref` VARCHAR(191) NULL — external id (FHIR Observation id / file-batch row); null for manual. `UNIQUE(source, source_ref)` gives idempotent re-import (MySQL allows many NULLs, so manual rows don't collide)
- `entered_by` INT UNSIGNED NULL → FK users.id (SET NULL) — who keyed THIS version (create or correction)
- `panel_ref` VARCHAR(120) NULL — optional grouping of results from one draw/DiagnosticReport
- `supersedes` BIGINT UNSIGNED NULL → FK lab_results.id (SET NULL), `UNIQUE` — the correction chain
- `created_at` / `updated_at`

**LOINC: later, not now.** `test_name` + `unit` + values display and store fine. A `loinc_codes`
reference table (mirroring `icd10cm_codes`) and normalization only earn their place once we
reconcile the SAME test across MULTIPLE providers with different local names — undesignable
before we know the providers. The nullable `loinc_code` column is reserved.

## Display — a "Labs" tab on the patient chart
Reuse the `VitalsSection` tab pattern (Vitals / Alerts / Time Log / Medications / Notifications /
Patient-reported → + **Labs**). `LabsPanel` is a read-only view of head-of-chain rows grouped by
`collected_at`, showing test · value+unit · reference range · **color-coded abnormal flag**
(high/low/critical). It reads `lab_results` and is **agnostic to source** — API, file, and manual
rows render identically. Backed by a read-only `GET /api/care/patients/:id/labs`, org+assignment
gated (`canAccessPatient`/`scopePatientParam`) like time-entries.

**Reachable from day one (increment-1 requirement).** The Time Log manual form shipped orphaned in
`PatientActivity` (never rendered) for weeks; the manual **"Add lab result"** button and the per-row
**"Correct"** action are wired directly into the Labs tab so they are reachable on first ship. No
orphaned form.

**Correction from day one (increment-1 requirement).** A hand-entered lab can be wrong, and a wrong
potassium on a chart is worse than a wrong time entry. Corrections use the **same `supersedes`
pattern as `time_entries`**: a per-row "Correct" opens the entry form pre-filled; saving inserts a
superseding row; the ledger shows head-of-chain only, so the corrected value replaces the original
(never both). Only the head of a chain can be corrected (409 otherwise); `UNIQUE(supersedes)` guards
the race.

## RPM note PDF — NO
Labs do **not** feed the signed RPM note/PDF. That note is an append-only, `content_hash`-anchored,
clinician-signed billing document; RPM billing (99453/99457/99458) is device-readings + management
time, not labs; and manual/file lab provenance is lower-assurance. Labs are a **chart view only**.
Revisit only behind a concrete clinical/billing requirement and a human-confirmation gate — never
auto-fed. (Same posture as the patient-reported timeline and the Option-B symptom-label rejection.)

## Increment 1 (this build)
`lab_results` table + read-only `GET /labs` + create + correct endpoints + a "Labs" chart tab with
a reachable **manual-entry** form (`source='manual'`) and a per-row **Correct** action. **No** LOINC
table, **no** API adapter, **no** PDF, **no** inbound patient-matching. `source`/`source_ref` ship
now so API/file adapters slot in later with no schema change.

## Do NOT build before a lab provider is chosen
- No provider-specific ingestion parser/mapper (HL7v2 vs FHIR vs CSV vs proprietary) — format unknown.
- No LOINC reference table / code normalization — unknown whether the provider sends LOINC or which analytes.
- No inbound patient-matching (MRN? name+DOB?) — provider-specific and high-risk (a mis-matched result is a safety event). Manual entry sidesteps it (staff pick the patient).
- No units/range modeling to one provider's conventions — store `value_text` (+ optional `value_num`) and `reference_range` as text; assume qualitative results and comments exist.
- No orders-out (CPOE) — results-in only; a different, larger integration class.
- No labs in the signed RPM note/PDF (above) — hard to unwind once in a signed artifact.
- Don't hard-model storage to Greenway `Observation`/`DiagnosticReport` — a FHIR adapter is one of possibly several; keep `lab_results` source-neutral.
