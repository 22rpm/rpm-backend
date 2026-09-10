# Conditions picker — full ICD-10-CM search (design)

**Status:** loader + search endpoint BUILT (not committed until reviewed); validation flip
and frontend PENDING. **Date:** 2026-09-10.

## Problem
The conditions picker is a curated ~40-code shortlist ([config/icd10Conditions.js](config/icd10Conditions.js)),
and that shortlist is a **storage gate**: `VALID_ICD10_CODES` rejects any code not on it, and
(until `ad3d96a`) an out-of-list code was **silently dropped to `null`** — stored as uncoded
free text on a list that feeds a billing document. A real patient problem list from the EHR
(15 codes: L60.3, L84, E11.69/.36/.40, I10, R60.0, E78.5, R26.0, Z91.81, M54.2, M70.32,
Z76.89, Z71.3, Z76.0) — most fall outside the shortlist. We've extended it twice and it still
falls short; the model is wrong, not the list.

## Decision
Replace the curated list **as a gate** with **search over the full local ICD-10-CM set**,
billable-only. Keep the curated list **as clinical guidance** (see "Guidance must survive").
There is no RPM-specific ICD-10 code list (CMS gates RPM on documented medical necessity,
not an enumerated set), so the picker must reach the whole code set — a subset can't be right.

### Two fixes, deliberately separable
1. **Silent-null → loud error — SHIPPED (`ad3d96a`).** A provided `icd10_code` that can't be
   validated now returns a 400 naming the code, never stores as uncoded. Behavior-preserving
   for the current dropdown (which only sends shortlist codes). This is a data-integrity fix,
   independent of search — it just stops the corruption while the rest is built.
2. **Full-set search + billable-only validation** — this doc.

## Why local, not the NLM API
The NLM Clinical Tables ICD-10-CM API is free, keyless, CORS-open and always-current — but it
has **no SLA** (explicitly "as is", 503s under load, ~50k calls/day soft cap). For a
billing-adjacent workflow that must fail predictably, and given the set is tiny (~1–2 MB
gzipped) and changes only annually, we **ship it locally** and take on a once-a-year refresh
instead of a runtime dependency. The API is used only as the one-time data source, if at all.
(RxNorm is live-first because the drug space is huge and volatile; ICD-10 is the opposite.)

## Billable-only
The picker only lets you **store** billable (fully-specified) codes. A bare header on a claim
is a rejection, and erroring at entry beats finding out at submission. Header codes are still
**loaded** (with `billable=0`) so a paste of one (`E11`) is answered at entry — "that's a
category, pick a specific code" — instead of a silent miss.

## Architecture (built)
- **`icd10cm_codes` table** ([migration 20260910120000](config/migrations/20260910120000_create_icd10cm_codes.js)):
  `code` (dot-less, PK), `billable`, `short_desc`, `long_desc`, `search_desc` (lowercased).
  ~98k rows; reference data, no PHI.
- **Loader** ([scripts/loadIcd10cm.js](scripts/loadIcd10cm.js)): parses the CMS fixed-width
  "order file" (no live fetch baked in — a moved CMS URL can't break a deploy), replaces the
  table transactionally. Re-run on the annual (Oct 1) revision.
- **Search** ([services/icd10.service.js](services/icd10.service.js) → `GET /api/conditions/search?q=`,
  authRequired): **code-first** (the clinician reads codes off the EHR screen). A code paste
  strips the dot, prefix-matches, and returns the code + its billable children so `L60.3`
  resolves in one step; a name query does a billable-only substring search. Codes are stored
  dot-less but always returned **dotted** for display/storage (`L603` → `L60.3`). Always-200;
  empty is valid; free-text stays a first-class fallback (mirrors `drugSearch`).

## Guidance MUST survive — this is the part worth keeping
Dropping the shortlist-as-gate must **not** drop the shortlist's clinical guidance. The
curated list encodes disambiguation that Cleo/Kinza reviewed, and it is easy to lose in a raw
98k-code search. It must be re-surfaced as **inline hints** keyed to codes/prefixes, shown at
the moment of picking:
- **The PVD fork** — I73.9 (peripheral vascular disease) vs the diabetic-coded
  E11.51/.52 (diabetic peripheral angiopathy). Picking/typing I73.9 for a diabetic patient
  must surface the pointer to the diabetic form. (Today it lives in the I73.9 *label*.)
- **Manifestation / first-listable warnings** — codes that must not be first-listed on a claim
  (ties to BILLING_FOLLOWUPS #14). Billable-only removes headers, but manifestation codes are
  a separate hazard the hint must flag.
- **Laterality / level prompts** — e.g. amputation-status Z89 (right/left, below/above knee)
  and the status-vs-active distinction (Z89 amputation absent vs E11.51/.52 active angiopathy).
- **Base-entry steering** — dementia base codes (F03.90 unspecified vs Alzheimer's-specific),
  so an unspecified case isn't over-coded.

Design: a small curated `guidance` map (`code`/prefix → hint text), seeded from the existing
[icd10Conditions.js](config/icd10Conditions.js) annotations, surfaced by the search UI when a
matching code appears. This map — the *content* — is the Cleo/Kinza-owned artifact; the
mechanical full-set search is not.

## Cleo / Kinza — the actual review ask (kept narrow on purpose)
**This is not "review our conditions model."** Precisely what changes:
1. A **restriction is removed**: today only ~40 curated codes can be stored; after this, **any
   valid billable ICD-10-CM code** can. It does **not** change which codes are clinically
   correct for any condition — it stops blocking valid codes the shortlist happened to omit.
2. The **curated clinical guidance is preserved**, moved from a gate to inline hints (the list
   above). Nothing curated is deleted; it changes role.
The review surface is therefore small: (a) confirm billable-only storage is the right guard,
and (b) confirm the guidance hints (the map content) read correctly. It should not sit in a
queue behind a broad model review — the mechanical change is already validated in code.

## Pending (not built)
- **Validation flip:** point `VALID_ICD10_CODES`'s check at `icd10cm_codes` (billable rows),
  normalizing the incoming dotted code to dot-less for the lookup and storing the dotted form.
  The `ad3d96a` guard already does the right thing against whatever set it validates against.
- **Frontend:** replace the curated dropdown with the search box (copy the medication
  drug-search UX), paste-to-resolve, guidance hints inline.
- **Guidance map:** extract the hint content from the curated annotations.

## Prod steps (yours, with the migration protocol)
1. `knex migrate:latest` — creates `icd10cm_codes` (mysqldump first; no data touched).
2. Download the CMS FY2026 "Code Descriptions in Tabular Order" zip, extract the order file,
   `node scripts/loadIcd10cm.js /path/to/icd10cm-order-2026.txt` on the box.
3. Verify: `curl -s "http://127.0.0.1:4000/api/conditions/search?q=L60.3"` (auth) → resolves.
   The endpoint is inert until the frontend calls it and the validation flip lands.
