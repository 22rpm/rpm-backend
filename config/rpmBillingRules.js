// config/rpmBillingRules.js
//
// CONFIRMED billing rules (biller sign-off, Aug 2026). These were documented
// defaults; they are now confirmed values. Still CONFIG, not code (req §3.8):
// CMS revises these annually, so they must be changeable without a deploy.
// Target remains a billing_rules DB table; this module is the interim single
// source, kept OUT of the computation logic.
module.exports = {
  // CONFIRMED. Billing period is the selected CALENDAR MONTH (not rolling 30d).
  period: "calendar_month",

  // CONFIRMED. Date of service for the MONTHLY codes (99454/99445/99457/99458)
  // is the last day of the selected month. (99453 is dated by the setup event —
  // see `setup` and the service.)
  dateOfService: "month_end",

  // A1. CONFIRMED. Device-SUPPLY code by DISTINCT transmission days in the
  // month. 0-1 days is NOT billable for supply — the note says so explicitly
  // rather than leaving it blank. This does NOT affect 99453 (see `setup`).
  //   0-1  -> not billable (insufficient transmission days)
  //   2-15 -> 99445
  //   16+  -> 99454
  deviceSupply: {
    minBillableDays: 2,
    insufficientMessage: "insufficient transmission days",
    // most-days-first; first band whose minDays is met wins
    bands: [
      { minDays: 16, code: "99454", label: "16+ transmission days" },
      { minDays: 2, code: "99445", label: "2-15 transmission days (short monitoring period)" },
    ],
  },

  // A2. CONFIRMED. Management time (cumulative minutes in the month).
  //   20+ min           -> 99457 (first unit) — but see interactiveRequirement
  //   each additional 20 -> 99458 (add-on to 99457)
  managementTime: {
    firstUnit: { minMinutes: 20, code: "99457" },
    additionalUnit: { everyMinutes: 20, code: "99458" },
  },

  // A2b. CONFIRMED — Quantix KEY RULE. 99457 is TWO independent tests, BOTH
  // required:
  //   (a) 20+ minutes of management time (managementTime.firstUnit), AND
  //   (b) at least one LIVE interactive communication with the patient/caregiver
  //       that month (phone, video, or in person). Data review alone does NOT
  //       satisfy (b).
  // A patient can pass (a) and fail (b); the note must state WHICH test failed.
  // 99458 is an add-on to 99457, so it only applies when 99457 is billable.
  interactiveRequirement: {
    appliesTo: "99457",
    // Interim detection of (b) from patient_calls. patient_calls.outcome is
    // currently FREE TEXT (constrained-outcome set is still a TODO), so we
    // cannot reliably tell "reached" from "no answer". Modes:
    //   "unverifiable" - presence of calls can't confirm a live connection, so
    //                    do NOT auto-pass; require provider confirmation. Zero
    //                    calls is still a hard fail. (interim default)
    //   "any_call"     - any logged call counts (optimistic; risks over-billing)
    //   "outcome"      - read outcome against qualifyingOutcomes (once the set
    //                    is constrained — flip to this then)
    detection: "unverifiable",
    qualifyingOutcomes: ["reached", "completed", "spoke", "connected"],
  },

  // A3. CONFIRMED. Setup/education. Billable ONCE per patient per device type,
  // based on the setup having occurred (patient consented, educated, device
  // issued). INDEPENDENT of transmission days — zero readings does not change
  // it. Enforced by rpm_device_setups UNIQUE(patient_id, device_type). Its date
  // of service is the setup event (setup_date, falling back to enrolled_at).
  setup: { code: "99453" },

  // Provider on the note. CONFIRMED operating assumption: one main clinician per
  // patient. If a patient has >1 care-team clinician, FLAG it rather than
  // guessing which one bills.
  provider: { assumeSingle: true },

  // A4. CONFIRMED. activity_category -> the template's TIME DOCUMENTATION bucket.
  //   Device Setup / Education  = device_assistance
  //   Data Review + Interaction = reading_review, patient_call,
  //     care_coordination, provider_communication, documentation
  // Only the Data Review + Interaction bucket counts toward the 20-min 99457/
  // 99458 threshold. Setup/education time backs 99453 (which is not time-gated).
  timeBuckets: {
    setup_education: ["device_assistance"],
    data_review_interaction: [
      "reading_review",
      "patient_call",
      "care_coordination",
      "provider_communication",
      "documentation",
    ],
  },
  // "other" is counted toward data_review_interaction, but its presence is
  // FLAGGED on the note so the provider can see uncategorised time exists.
  uncategorized: { category: "other", bucket: "data_review_interaction" },

  // Attestation. This is the Quantix template's OWN wording, used VERBATIM (not
  // authored by engineering). `pending` = awaiting formal compliance sign-off on
  // acceptability + whether e-signature is allowed; the text is here (not in the
  // PDF layout) so it can be swapped without touching the PDF when compliance
  // finalizes it.
  attestation: {
    pending: true,
    text:
      "I have reviewed the patient's remotely transmitted physiologic data, " +
      "interpreted the results, and communicated with the patient/caregiver as " +
      "indicated. All services documented herein were personally performed or " +
      "directly supervised in accordance with applicable Medicare and payer " +
      "guidelines.",
  },
};
