// config/rpmBillingRules.js
//
// CONFIG, not code (§3.8). Clinical time and transmission days are captured
// independently; these rules decide what each contributes to which CPT code.
// These are DOCUMENTED DEFAULTS pending biller confirmation — CMS revises them
// annually, so they must be changeable without a code deploy. Target: a
// billing_rules DB table (see RPM_NOTE_POLICY.md). This module is the interim
// single source, kept OUT of the computation logic so it's the one place to
// change and trivially movable to a table.
module.exports = {
  // A1. Device-supply code by DISTINCT transmission-day BANDS — never a 16-day
  // boolean. Count the days, then take the first band (most-days-first) whose
  // minDays is met. A short period is billable (99445), not "unbillable".
  deviceSupplyBands: [
    { minDays: 16, code: "99454", label: "16+ transmission days" },
    // 99445 short-period: exact day range + reimbursement PENDING biller.
    {
      minDays: 2,
      code: "99445",
      label: "short monitoring period (below 16 days)",
      pending: true,
    },
  ],

  // A2. Management-time thresholds (cumulative minutes for the period).
  managementTime: {
    firstUnit: { minMinutes: 20, code: "99457" },
    additionalUnit: {
      minMinutes: 40,
      code: "99458",
      note: "one additional 20-minute unit",
    },
  },

  // A3. Setup — one-time device education.
  setup: {
    code: "99453",
    note: "device education completed (rpm_device_setups row exists)",
  },

  // A4. activity_category -> what the captured time contributes to. Biller
  // confirms this split.
  categoryContribution: {
    device_assistance: "setup",
    reading_review: "management",
    patient_call: "management",
    care_coordination: "management",
    provider_communication: "management",
    documentation: "management",
    other: "management",
  },
};
