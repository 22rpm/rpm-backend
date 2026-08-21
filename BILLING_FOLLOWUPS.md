# RPM billing / claim follow-ups

Tracked, not all built. The RPM note computes CPT eligibility and dates of
service, but a submittable claim needs more than this system currently models.

## 1. ICD-10 diagnosis code — REQUIRED on every claim, NOT modelled — OPEN
`patient_conditions` stores free-text names ("Hypertension"), not codes (I10).
Deferred by Ricky (he'll add it later). Until then **the note is NOT a
submittable claim on its own** — the biller adds the diagnosis code. The note now
says so explicitly (`compliance_checks`); do not let any UI imply otherwise.
Schema proposed (both name + code on the condition row, backed by an optional
lookup) — not built.

## 2. No-conflicting-codes check — OUTSIDE this system — OPEN (manual)
2026 claim guidance requires confirming no overlapping RTM or Home Health codes
were billed for the same period. We have no visibility into that. The note flags
it as a manual check (`compliance_checks`) rather than implying verification.

## 3. Place of Service — REQUIRED on claims, NOT modelled — OPEN
11 (Office) vs 02/10 (Telehealth). Schema proposed (org default + per-patient
override, resolved per-claim) — not built.

## 4. Provider NPI — REQUIRED on claims, NOT stored anywhere — OPEN
Not on `users`. Must live somewhere and appear on the note. Schema proposed
(`user_provider_profiles.npi` + org billing NPI) — not built.

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
