// config/rpmBillingRules.js
//
// CONFIRMED billing rules (biller sign-off, Aug 2026). These were documented
// defaults; they are now confirmed values. Still CONFIG, not code (req §3.8):
// CMS revises these annually, so they must be changeable without a deploy.
// Target remains a billing_rules DB table; this module is the interim single
// source, kept OUT of the computation logic.
const { QUALIFYING_OUTCOMES } = require("./callOutcomes");

module.exports = {
  // CONFIRMED. Billing period is the selected CALENDAR MONTH (not rolling 30d).
  period: "calendar_month",

  // CONFIRMED. Date of service is PER CODE — "the date the threshold (days or
  // minutes) was met" (2026 claim guidance), NOT month-end. Different codes in
  // the same month can therefore carry different dates of service:
  //   99445 -> date the 2nd distinct transmission day occurred
  //   99454 -> date the 16th distinct transmission day occurred
  //   99470 -> date cumulative management minutes first reached 10
  //   99457 -> date cumulative management minutes first reached 20
  //   99458 (nth) -> date cumulative minutes first reached 20 + n*20
  //   99453 -> the setup/education event date
  // The service computes all of these; the biller confirms which appears on the
  // note itself. (Month-end fallback only if a threshold date can't be derived.)
  dateOfService: "threshold_met",

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

  // A2. CONFIRMED. Management time by cumulative Data Review + Interaction
  // minutes in the month. No longer "20+ or nothing":
  //   10-19 -> 99470
  //   20-39 -> 99457
  //   40-59 -> 99457 + 1x 99458
  //   60+   -> 99457 + one 99458 per additional 20 min, no cap
  managementTime: {
    // Mutually-exclusive base tier — the highest threshold met wins. 99470 and
    // 99457 never bill together.
    tiers: [
      { minMinutes: 20, code: "99457" },
      { minMinutes: 10, code: "99470" },
    ],
    // Add-on: one 99458 per full additional 20 min beyond the first 20. Only
    // stacks on the 99457 base (never on 99470). No cap.
    additionalUnit: { everyMinutes: 20, code: "99458", base: "99457" },
  },

  // A2b. CONFIRMED — Quantix KEY RULE. The management code is TWO independent
  // tests, BOTH required:
  //   (a) enough minutes for the tier (10 for 99470, 20 for 99457), AND
  //   (b) at least one LIVE interactive communication with the patient/caregiver
  //       that month (phone, video, or in person). Data review alone does NOT
  //       satisfy (b).
  // A patient can pass (a) and fail (b); the note states WHICH test failed.
  // 99458 is an add-on to 99457, so it only applies when 99457 is billable.
  interactiveRequirement: {
    // Which base codes require (b). 99457 CONFIRMED requires it. 99470 is set to
    // require it by default (conservative) — PENDING biller confirmation on
    // whether 99470 is time-only. Drop "99470" from this list if time-only.
    appliesTo: ["99457", "99470"],
    // Interim detection of (b) from patient_calls. patient_calls.outcome is
    // currently FREE TEXT (constrained-outcome set is still a TODO), so we
    // cannot reliably tell "reached" from "no answer". Modes:
    //   "unverifiable" - presence of calls can't confirm a live connection, so
    //                    do NOT auto-pass; require provider confirmation. Zero
    //                    calls is still a hard fail. (interim default)
    //   "any_call"     - any logged call counts (optimistic; risks over-billing)
    //   "outcome"      - read outcome against qualifyingOutcomes
    // The constrained outcome set now exists (config/callOutcomes.js). FLIP this
    // to "outcome" as part of the existing-row data migration (so historical
    // calls are normalised before exact-match evaluation runs against them).
    detection: "unverifiable",
    qualifyingOutcomes: QUALIFYING_OUTCOMES, // ["Reached patient","Reached caregiver"]
  },

  // A3. CONFIRMED. Setup/education. Billable ONCE per patient per device type,
  // based on the setup having occurred (patient consented, educated, device
  // issued). INDEPENDENT of transmission days — zero readings does not change
  // it. Enforced by rpm_device_setups UNIQUE(patient_id, device_type). Its date
  // of service is the setup event (setup_date, falling back to enrolled_at).
  setup: { code: "99453" },

  // Reimbursement — CONFIGURABLE national averages (per our RPM reference).
  // These VARY BY LOCALITY and are stored for planning only. §3.9: keep revenue
  // SEPARATE from eligibility — do NOT display estimated revenue anywhere yet.
  reimbursement: {
    currency: "USD",
    basis: "national_average",
    display: false, // gate: nothing surfaces estimated revenue until turned on
    note: "national averages; vary by locality; not for display",
    amounts: {
      "99453": 21.71, // initial setup and configuration
      "99454": 52.11, // monthly device monitoring, 16+ days
      "99445": 52.11, // monthly device monitoring, 2-15 days
      "99470": 26.05, // 10 minutes of RPM time
      "99457": 51.77, // 20 minutes of RPM time
      "99458": 41.42, // each additional 20 minutes (no limit)
    },
  },

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

  // Attestation. The Quantix template's OWN wording, used VERBATIM (not authored
  // by engineering). CONFIRMED Aug 2026: e-signature is acceptable (it is how
  // providers already sign) and this is the approved wording. Kept in config so
  // it can still be swapped without touching the PDF layout.
  attestation: {
    pending: false,
    text:
      "I have reviewed the patient's remotely transmitted physiologic data, " +
      "interpreted the results, and communicated with the patient/caregiver as " +
      "indicated. All services documented herein were personally performed or " +
      "directly supervised in accordance with applicable Medicare and payer " +
      "guidelines.",
  },
};
