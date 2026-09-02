# Biller role — design

Read-only, multi-org billing role. A biller works across SOME clinics (not one,
not all), reads what's needed to bill, and can change nothing.

## Structure

- **Multi-org via `biller_organizations`** (biller_user_id → organization_id). A
  biller's `users.organization_id` is NULL (like super-admin); the join is their
  allowed clinic set.
- **Fail-closed org scope.** `resolveOrgScope` has a biller branch: the biller
  picks one clinic per request via `?organizationId=`, validated against their
  `biller_organizations` set. No membership row (including an unassigned biller's
  empty set) → 403; missing param → 400. An empty set is zero access, never all.
- **Not in `ORG_WIDE_ROLES` or `CLINICAL_STAFF`.** So a biller inherits no
  alert/vitals exposure and can reach no write route. Access is granted only on
  the specific read gates below.
- **Provisioning is a super-admin UI** (`/api/billing/billers`, the Billers
  modal), not SQL: create a biller + assign/reassign clinics with checkboxes.

## What a biller can reach

- `GET /api/patients/billing-summary` — the roster overview (BILLING_OVERVIEW_ROLES).
- `GET /api/patients/:id/rpm-note` and `/rpm-note/signed` — the **full** RPM note,
  read-only (BILLING_OVERVIEW_ROLES). See the reversal below.
- `GET /api/billing/my-orgs` — their clinic selector list.
- Nothing else. Signing (`/rpm-note/sign`) stays **clinician-only**, enforced at
  the route and re-enforced in `rpmNoteSign.service`.

## Invariants (must stay true)

1. **Read-only.** No sign, edit, or confirm for a biller. The note page hides the
   Sign button (`canSign = role === 'clinician'`), and the sign endpoint refuses a
   biller regardless of UI.
2. **Scoped to assigned clinics.** A biller reaches a patient's data only for
   patients in an org they're assigned to — enforced by `resolveOrgScope`
   (allowed-set) + `scopePatientParam` (patient-in-org), on every request.

## Reversal (2026-09-02): full note, not the reduced projection

**PR B originally shipped the biller a REDUCED, minimum-necessary per-patient
projection** — demographics + insurance + ICD-10 + codes/threshold facts, with a
dedicated `/api/billing/patients/:id/note` + `/demographics` and a `BillerPatient`
page — deliberately omitting vitals values, the provider's clinical-note
narrative, and the call log.

**That was reversed on purpose.** A biller now opens the **standard full RPM
note** (the same `RpmNotePage` a clinician sees) when they click a patient from
the billing overview.

**Why the reversal:**
- The clinic's biller **already receives these full notes today** — the clinical
  summary is not new exposure, it's the document they bill from.
- They **need** that summary to bill accurately; the reduced projection made them
  work from less than what they already have.

**What was removed:** the reduced endpoints (`/api/billing/patients/:id/note` and
`/demographics`), their service/controller functions, the `BillerPatient` page and
its route, and the per-patient PDF (the full note's own Save-as-PDF/Print covers
it). The **month-wide roster PDF export stays** — that one was already right.

**What did NOT change:** the two invariants above. Widening the *content* a biller
sees did not widen what they can *do* (still read-only) or *which patients* they
can see (still their assigned clinics only).

> Do not read the reduced projection as the current intent — it was superseded.
> The biller sees the full note, read-only, org-scoped.
