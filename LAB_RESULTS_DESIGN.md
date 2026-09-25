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

## Increment 2 — CSV file import (BUILT 2026-09-25)
Staff-driven CSV import, `source='file'`. **Patient is chosen first** (the import lives on the Labs
tab of a patient chart, so every row applies to that patient) — **no automated patient matching**,
which removes the mis-file risk. Reachable via an **"Import CSV"** button next to "Add lab result".

**Flow:** pick file → parse client-side (papaparse) → **mandatory preview** (valid rows shown with
parsed values; unparseable/invalid rows listed with a reason and **skipped**) → confirm → POST the
valid rows → server re-validates, writes, returns a per-row outcome (written / duplicate / error).
Nothing is written until confirm.

**CSV column format** (define-our-own; `value` maps to `value_text`; no patient column — extra
columns are ignored). Downloadable as a template from the import UI:

| Column | Required | lab_results field |
|---|---|---|
| `test_name` | ✅ | test_name |
| `value` | ✅ | value_text (as reported) |
| `unit` | | unit |
| `reference_range` | | reference_range |
| `abnormal_flag` | | abnormal_flag (normal/low/high/critical_low/critical_high/abnormal, or blank) |
| `collected_at` | | collected_at (ISO 8601 or YYYY-MM-DD) |
| `resulted_at` | | resulted_at |
| `resulting_lab` | | resulting_lab |
| `loinc_code` | | loinc_code |

**Dedup / `source_ref` — server-derived, not client-trusted.** The client sends only the parsed
rows (no hash). The server validates+normalizes them, serializes the whole batch canonically (fixed
key order, dates→ISO, file order), and computes `batchHash = SHA-256(canonical)` **server-side**;
`source_ref = "<batchHash>:<rowIndex>"`. Re-importing the same file reproduces the same canonical
batch → same `source_ref`s → every row dup-skips on `UNIQUE(source, source_ref)`. A browser can't
forge a key that doesn't match the content it submits.

**Limits:** ≤ 1 MB file, ≤ 500 data rows (checked client-side, capped server-side).
**Same file uploaded twice:** all rows reported as duplicates and skipped; zero new rows.
**CAVEAT — the key is per-batch, not per-row-content.** Because `batchHash` is computed over the
WHOLE submitted batch, changing the row set (adding/removing/editing/reordering any row) changes the
hash for **every** `source_ref` in that upload. So re-uploading a *modified* file re-imports rows
that are byte-identical to ones already imported from the earlier file — the dedup guarantee holds
only for the **exact same batch**, not for individual rows across different batches. This is a
deliberate tradeoff (a per-row content hash would instead collide on legitimately-identical rows,
e.g. the same test/value twice in one draw). The mandatory preview makes any re-import **visible**
before it's written — the failure mode is a duplicate the reviewer can see and cancel, not a silent
one. If per-row idempotency across edited files is ever needed, switch `source_ref` to a per-row
content hash and accept the identical-row collision, or add an explicit per-row external id.
**Corrections:** imported (`file`) rows are correctable via the existing per-row Correct action
(a correction inserts a `manual` superseding row); head-of-chain list means the corrected value
replaces the original.
**No migration** — `source`/`source_ref` and `UNIQUE(source, source_ref)` already exist from
increment 1. Endpoint: `POST /api/care/patients/:patientId/labs/import`, gated CLINICAL_STAFF +
resolveOrgScope + scopePatientParam (same as the other lab routes). New dashboard dep: `papaparse`.

## Planned increment — Lab-results ingest API (Fax Intelligence → RPM). PLANNED, not built.
Fax Intelligence (a separate app) OCRs faxed lab reports, classifies them, matches the patient, and
has a **human confirm** the extracted values. On confirmation it pushes results into `lab_results`
with `source='api'`. RPM is the receiving end. Waits on the Fax-Intelligence-side decisions below.

**1. Endpoint shape — batch, server-to-server, distinct from the clinician create.**
`POST /api/integrations/labs` (new namespace, not `/api/care/...`). One report = one patient + many
analytes:
```
{ patient_id: <RPM patient id>, results: [ { test_name, value_text, value_num?, unit?,
  reference_range?, abnormal_flag?, collected_at?, resulted_at?, resulting_lab?, loinc_code?,
  panel_ref?, source_ref }, … ] }
```
Differs from the clinician create: no browser session / `requireRole`; patient identified in the
body (verified, §4) not the URL; MANY results per call; `source='api'`; `source_ref` required;
`entered_by = NULL` (no RPM human — the reviewer lives in Fax Intelligence); no UI; returns a
**per-result outcome array** (`created` / `duplicate` / `error`) so Fax Intelligence can reconcile.
Reuses `labResults.service.createResult` with `source='api'` + `source_ref`.

**2. Auth — ES384 service JWT (reuse the Greenway approach, mirrored).** RPM is the verifier here.
Fax Intelligence signs a short-lived **ES384 client-assertion JWT** with its private key; a new
`verifyServiceJwt` middleware verifies it (NOT `requireRole` — the caller is a machine principal,
not a CLINICAL_STAFF user). Key distribution: **(a) configured public key** in RPM env (`jwt.verify`
with `algorithms:['ES384']`, `iss`, `aud`) — recommended for v1; **(b) JWKS URL** later (needs a
JWKS client). Same asymmetric family RPM already stood up for Greenway; do NOT invent an API-key
scheme. The principal is a fixed identity (`fax-intelligence`) scoped only to this route and to the
org(s) it may write to.

**3. Idempotency — `UNIQUE(source='api', source_ref)`.** `source_ref` = a STABLE per-analyte id from
Fax Intelligence (its own result UUID, or `${faxReportId}:${resultIndex}`), identical across retries
of the same result. A duplicate POST hits the UNIQUE and is treated as **idempotent success**
(`{outcome:"duplicate", id}`, 200) — never a 500 (same catch pattern as `correctLab`).

**4. Patient identification — RPM verifies, never re-matches.** Fax Intelligence sends RPM's own
`patient_id` (resolved in its human-review step), NOT name/DOB/MRN. Before any write RPM verifies the
id (a) exists, (b) is role `patient`, (c) belongs to the org the calling principal is authorized for.
If it doesn't resolve to a patient in the authorized org → reject 4xx, write nothing (fail closed).
What prevents a mis-file: the human confirms the match in Fax Intelligence BEFORE push; RPM verifies
the id resolves to a real in-org patient; `source_ref` prevents dupes; NO fuzzy matching in RPM.
Residual risk RPM can't catch: a human confirming the WRONG patient (garbage-in) — mitigate by RPM
**echoing the patient name back** in the response so Fax Intelligence shows "wrote to: Jane Doe".

**5. Audit + provenance.** Each API write → `audit_log` (actor = machine principal `fax-intelligence`,
new action e.g. `LAB_RESULT_INGESTED`, entity patient/patient_id, metadata `{source:'api', source_ref,
result_id, external_reviewer?}` — NO PHI values). UI: the Labs tab shows a **Source badge** (Fax vs
Keyed vs CSV) from `lab_results.source` so a clinician sees a faxed value isn't hand-keyed.

**6. Read-only in RPM; correct at source.** An API result's source of truth is the fax + Fax
Intelligence's reviewed extraction. Correcting it in RPM would silently diverge. So **API rows are
read-only in RPM** — the per-row Correct is disabled for `source='api'` (show "corrected at source");
Fax Intelligence re-reviews and re-pushes a correction. (Correct stays enabled for `manual`/`file`.)

**Decisions needed on the Fax Intelligence side before this can be built:**
- **Patient-id contract:** Fax Intelligence must send RPM's `patient_id` — and needs a way to obtain
  it (an RPM lookup API? operator paste?).
- **Org contract:** one principal per org, or org in the payload verified against the principal's
  allowed orgs?
- **Key/JWT contract:** signing key (or JWKS URL), algorithm (ES384), claims (`iss`/`aud`/`exp`/`jti`),
  token lifetime.
- **`source_ref` scheme** and the **correction model:** how a re-push represents a correction (a new
  `source_ref` that supersedes the prior, or an explicit `supersedes_source_ref`).
- **`abnormal_flag` mapping:** Fax Intelligence maps extracted flags to RPM's enum
  (normal/low/high/critical_low/critical_high/abnormal); unmappable → null.
- **Field/format contract:** field names, units, date formats; who canonicalizes.
- **Batch semantics:** atomic-per-report vs per-row partial success (recommend per-row idempotent
  with the per-row outcome array).
- **BAA** between the two apps (fax lab reports are PHI), even under one owner, if they're separate
  legal/vendor entities.
