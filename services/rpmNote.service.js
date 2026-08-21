// services/rpmNote.service.js
//
// Read-only pre-fill for the RPM monthly note. Computes everything we already
// have (demographics, enrollment, monitoring, vitals, communication, time) for
// a patient + month, and applies the configurable billing rules to report which
// CPT codes the data supports. It NEVER fills clinical judgment (assessment,
// plan, attestation) — those stay blank for the provider.
const db = require("../config/db");
const rules = require("../config/rpmBillingRules");

function httpError(status, message) {
  const e = new Error(message);
  e.httpStatus = status;
  return e;
}

// "YYYY-MM" -> calendar-month window. CONFIRMED: the billing period is the
// selected calendar month (not a rolling 30-day period).
function monthWindow(month) {
  let y, m;
  if (typeof month === "string" && /^\d{4}-\d{2}$/.test(month)) {
    y = Number(month.slice(0, 4));
    m = Number(month.slice(5, 7));
  }
  if (!y || !m || m < 1 || m > 12) {
    const now = new Date();
    y = now.getUTCFullYear();
    m = now.getUTCMonth() + 1;
  }
  const pad = (n) => String(n).padStart(2, "0");
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const lastDay = new Date(Date.UTC(ny, nm - 1, 0)).getUTCDate();
  return {
    label: `${y}-${pad(m)}`,
    start: `${y}-${pad(m)}-01`,
    next: `${ny}-${pad(nm)}-01`,
    end: `${y}-${pad(m)}-${pad(lastDay)}`,
  };
}

// Device-SUPPLY code (99445/99454) from distinct transmission days. Returns the
// matched band, or null when under the billable minimum (0-1 days). Does NOT
// govern 99453, which is independent of transmission days.
function deviceSupplyForDays(days) {
  if (!days || days < rules.deviceSupply.minBillableDays) return null;
  for (const band of rules.deviceSupply.bands) {
    if (days >= band.minDays) return band;
  }
  return null;
}

// Date of service = "the date the threshold was met". Given ordered {date,secs}
// contributions, return the date at which the running total first reaches
// thresholdMinutes (or null if never). Used for per-code minute-threshold DOS.
function dateThresholdMet(contribs, thresholdMinutes) {
  const need = thresholdMinutes * 60;
  let acc = 0;
  for (const c of contribs) {
    acc += c.secs;
    if (acc >= need) return c.date;
  }
  return null;
}

async function getRpmNote({ patientId, orgScope, month }) {
  const win = monthWindow(month);

  // Patient + profile (mrn included; may be null).
  const [prows] = await db.query(
    `SELECT u.id, u.name,
            DATE_FORMAT(p.date_of_birth, '%Y-%m-%d') AS date_of_birth,
            p.mrn,
            DATE_FORMAT(p.enrolled_at, '%Y-%m-%d') AS enrolled_at,
            p.program_status,
            (p.user_id IS NOT NULL) AS has_profile
       FROM users u
       JOIN role r ON r.user_id = u.id AND r.role_type = 'patient'
       LEFT JOIN patient_profiles p ON p.user_id = u.id
      WHERE u.id = ?`,
    [patientId]
  );
  if (!prows.length) throw httpError(404, "Patient not found");
  const p = prows[0];

  // Provider(s) — care team.
  const [team] = await db.query(
    `SELECT u.id, u.name FROM patient_doctor_assignments pda
       JOIN users u ON u.id = pda.doctor_id WHERE pda.patient_id = ? ORDER BY u.name`,
    [patientId]
  );

  // Consent — append-only; current = latest event, obtained if its status is 'obtained'.
  const [crows] = await db.query(
    `SELECT status, DATE_FORMAT(consent_date, '%Y-%m-%d') AS consent_date, method
       FROM patient_consents WHERE patient_id = ?
      ORDER BY consent_date DESC, id DESC LIMIT 1`,
    [patientId]
  );
  const consentRow = crows[0] || null;
  const consent = {
    obtained: !!consentRow && consentRow.status === "obtained",
    method: consentRow ? consentRow.method : null,
    date: consentRow ? consentRow.consent_date : null,
  };

  // Devices provided (active) + device education (99453).
  const [devices] = await db.query(
    `SELECT pd.device_type, dt.label, pd.serial_number,
            DATE_FORMAT(pd.assigned_at, '%Y-%m-%d') AS assigned_at
       FROM patient_devices pd
       LEFT JOIN device_types dt ON dt.\`key\` = pd.device_type
      WHERE pd.patient_id = ? AND pd.status = 'active'`,
    [patientId]
  );
  const [setups] = await db.query(
    `SELECT device_type, DATE_FORMAT(setup_date, '%Y-%m-%d') AS setup_date, billed
       FROM rpm_device_setups WHERE patient_id = ?`,
    [patientId]
  );

  // Monitoring: distinct transmission days (ordered, any device). The count sets
  // the device-supply band; the ordered dates give its threshold-met DOS.
  const [txDays] = await db.query(
    `SELECT DISTINCT DATE_FORMAT(created_at, '%Y-%m-%d') AS d
       FROM dev_data
      WHERE user_id = ? AND created_at >= ? AND created_at < ?
      ORDER BY d`,
    [patientId, win.start, win.next]
  );
  const daysWithReadings = txDays.length;
  const num = (x) => (x === null || x === undefined ? null : Number(x));

  const [[v]] = [
    await db.query(
      `SELECT
         MIN(CAST(data->>'$.systolic'  AS SIGNED)) AS sys_min,
         MAX(CAST(data->>'$.systolic'  AS SIGNED)) AS sys_max,
         ROUND(AVG(CAST(data->>'$.systolic'  AS SIGNED))) AS sys_avg,
         MIN(CAST(data->>'$.diastolic' AS SIGNED)) AS dia_min,
         MAX(CAST(data->>'$.diastolic' AS SIGNED)) AS dia_max,
         ROUND(AVG(CAST(data->>'$.diastolic' AS SIGNED))) AS dia_avg,
         MIN(CAST(data->>'$.bpm' AS SIGNED)) AS hr_min,
         MAX(CAST(data->>'$.bpm' AS SIGNED)) AS hr_max,
         ROUND(AVG(CAST(data->>'$.bpm' AS SIGNED))) AS hr_avg,
         COUNT(*) AS n
       FROM dev_data
      WHERE user_id = ? AND dev_type = 'bp'
        AND created_at >= ? AND created_at < ?`,
      [patientId, win.start, win.next]
    ),
  ].map((r) => r[0]);

  // Time: head-of-chain time_entries in the month, individual rows ordered by
  // start (so the running total gives the management threshold-met DOS).
  const [timeRows] = await db.query(
    `SELECT t.activity_category,
            DATE_FORMAT(t.started_at, '%Y-%m-%d') AS d,
            t.duration_seconds AS secs
       FROM time_entries t
       LEFT JOIN time_entries s ON s.supersedes = t.id
      WHERE s.id IS NULL AND t.patient_id = ? AND t.organization_id = ?
        AND t.started_at >= ? AND t.started_at < ?
      ORDER BY t.started_at, t.id`,
    [patientId, orgScope, win.start, win.next]
  );
  // Map each activity_category into the template's two TIME DOCUMENTATION
  // buckets. Only Data Review + Interaction counts toward the management tier;
  // Setup/Education backs 99453 (which is not time-gated).
  const setupCats = new Set(rules.timeBuckets.setup_education);
  const reviewCats = new Set(rules.timeBuckets.data_review_interaction);
  let setupSecs = 0;
  let reviewSecs = 0;
  let otherSecs = 0;
  const byCategory = {};
  const reviewContribs = []; // ordered {date,secs} for the review bucket
  for (const row of timeRows) {
    const secs = Number(row.secs || 0);
    byCategory[row.activity_category] =
      (byCategory[row.activity_category] || 0) + Math.round(secs / 60);
    if (setupCats.has(row.activity_category)) setupSecs += secs;
    else {
      // review-bucket categories, plus uncategorised ("other")
      reviewSecs += secs;
      reviewContribs.push({ date: row.d, secs });
      if (!reviewCats.has(row.activity_category)) otherSecs += secs;
    }
  }
  const setupEducationMinutes = Math.round(setupSecs / 60);
  const dataReviewMinutes = Math.round(reviewSecs / 60);
  const uncategorizedMinutes = Math.round(otherSecs / 60);
  const totalMinutes = setupEducationMinutes + dataReviewMinutes;

  // Communication — head-of-chain patient_calls in the month.
  const [calls] = await db.query(
    `SELECT c.direction, c.outcome, c.note,
            DATE_FORMAT(c.started_at, '%Y-%m-%d') AS date
       FROM patient_calls c
       LEFT JOIN patient_calls cs ON cs.supersedes = c.id
      WHERE cs.id IS NULL AND c.patient_id = ? AND c.organization_id = ?
        AND c.started_at >= ? AND c.started_at < ?
      ORDER BY c.started_at`,
    [patientId, orgScope, win.start, win.next]
  );

  // Reference-only: provider clinical notes documented THIS MONTH (head of the
  // append-only chain). This is history shown beside the blank assessment — it
  // is NEVER folded into the assessment the provider signs. Labeled reference.
  const [priorNotes] = await db.query(
    `SELECT n.note_type, n.body, au.name AS author,
            DATE_FORMAT(n.created_at, '%Y-%m-%d') AS date
       FROM clinical_notes n
       LEFT JOIN clinical_notes ns ON ns.supersedes = n.id
       LEFT JOIN users au ON au.id = n.staff_user_id
      WHERE ns.id IS NULL AND n.patient_id = ? AND n.organization_id = ?
        AND n.created_at >= ? AND n.created_at < ?
      ORDER BY n.created_at`,
    [patientId, orgScope, win.start, win.next]
  );

  // ---- Apply the confirmed billing rules -------------------------------------
  // Device SUPPLY (99445/99454). DOS = the date the day-count crossed the band
  // threshold (2nd distinct day for 99445, 16th for 99454). Independent of 99453.
  const deviceSupplyBand = deviceSupplyForDays(daysWithReadings);
  const deviceSupplyDos = deviceSupplyBand
    ? (txDays[deviceSupplyBand.minDays - 1] || {}).d || null
    : null;
  const deviceSupply = deviceSupplyBand
    ? { code: deviceSupplyBand.code, days: daysWithReadings, reason: null, date_of_service: deviceSupplyDos }
    : {
        code: null,
        days: daysWithReadings,
        reason: rules.deviceSupply.insufficientMessage,
        date_of_service: null,
      };

  // Management base tier (mutually exclusive): 10-19 -> 99470, 20+ -> 99457.
  const tiers = rules.managementTime.tiers;
  const baseTier = tiers.find((t) => dataReviewMinutes >= t.minMinutes) || null;
  const minTier = tiers[tiers.length - 1].minMinutes; // 10
  const testA = !!baseTier; // enough minutes for SOME tier

  // (b) live interactive detection — from patient_calls (mode-dependent).
  const mode = rules.interactiveRequirement.detection;
  let testB; // true | false | null(unverifiable)
  let testBBasis;
  if (calls.length === 0) {
    testB = false;
    testBBasis = "no calls logged this month";
  } else if (mode === "any_call") {
    testB = true;
    testBBasis = `${calls.length} call(s) logged (any-call mode)`;
  } else if (mode === "outcome") {
    // Exact match against the constrained outcome set (config/callOutcomes.js).
    // Three states, because on a billing document "the call didn't reach the
    // patient" (evidence) and "nobody recorded what happened" (missing evidence)
    // are DIFFERENT facts:
    //   qualifying outcome present            -> PASS (true)
    //   no qualifying, but a call has a NULL  -> NOT RECORDED / indeterminate (null)
    //     outcome (blank on a logged call)       — never asserted as a failure
    //   no qualifying, all outcomes recorded  -> FAILED (false)
    const q = new Set(rules.interactiveRequirement.qualifyingOutcomes);
    const qualifying = calls.filter((c) => c.outcome && q.has(c.outcome));
    const unrecorded = calls.filter((c) => !c.outcome); // NULL / blank outcome
    if (qualifying.length) {
      testB = true;
      testBBasis = "a call reached the patient or caregiver";
    } else if (unrecorded.length) {
      testB = null; // NOT RECORDED — do not assert a failure
      const dates = [...new Set(unrecorded.map((c) => c.date))].join(", ");
      testBBasis = `outcome not recorded on the ${dates} call(s) — cannot determine a live interaction; record the outcome`;
    } else {
      testB = false; // recorded non-qualifying outcomes (No answer, etc.)
      testBBasis = "no logged call reached the patient or caregiver (recorded outcomes are non-qualifying)";
    }
  } else {
    testB = null;
    testBBasis = `${calls.length} call(s) logged, but outcome is free text — cannot confirm a live interaction; provider must verify`;
  }

  // Does the CHOSEN base code require (b)? Per-code + configurable (99457 yes;
  // 99470 default-yes pending biller).
  const requiresInteractive = baseTier
    ? rules.interactiveRequirement.appliesTo.includes(baseTier.code)
    : false;
  const interactive = {
    test_a_minutes_met: testA,
    test_b_live_interaction: testB,
    test_b_basis: testBBasis,
    test_b_required: requiresInteractive,
    detection_mode: mode,
  };

  // Billable when a tier is reached AND (if that code requires it) (b) passes.
  // 99458 add-ons stack only on the 99457 base. Per-instance threshold-met DOS.
  const billableBase = testA && (!requiresInteractive || testB === true);
  const managementCodes = [];
  const managementDetails = []; // per instance: { code, date_of_service }
  let additionalUnits = 0;
  if (billableBase) {
    managementCodes.push(baseTier.code);
    managementDetails.push({
      code: baseTier.code,
      date_of_service: dateThresholdMet(reviewContribs, baseTier.minMinutes) || win.end,
    });
    if (baseTier.code === rules.managementTime.additionalUnit.base) {
      const every = rules.managementTime.additionalUnit.everyMinutes; // 20
      additionalUnits = Math.floor((dataReviewMinutes - baseTier.minMinutes) / every);
      for (let k = 1; k <= additionalUnits; k++) {
        managementCodes.push(rules.managementTime.additionalUnit.code);
        managementDetails.push({
          code: rules.managementTime.additionalUnit.code,
          date_of_service:
            dateThresholdMet(reviewContribs, baseTier.minMinutes + k * every) || win.end,
        });
      }
    }
  }

  const setupSupported = setups.length > 0;
  // 99453 date of service = the setup event; fall back to enrollment date.
  const setupDos =
    (setups.find((s) => s.setup_date) || {}).setup_date || p.enrolled_at || null;

  // Provider: single-clinician operating assumption; flag if more than one.
  const multipleProviders = team.length > 1;

  // Missing-data / billing flags (§3.9) — never a refusal.
  const missing = [];
  if (!p.has_profile) missing.push("No patient_profiles row — demographics unavailable");
  if (!p.date_of_birth) missing.push("No date of birth on record");
  if (!p.mrn) missing.push("No MRN on record");
  if (!team.length) missing.push("No care-team provider assigned");
  if (multipleProviders)
    missing.push(
      `Patient has ${team.length} care-team clinicians — confirm the billing provider (assumption is one per patient)`
    );
  if (!consent.obtained) missing.push("Consent not on record");
  if (!devices.length) missing.push("No active device on record");
  if (!setupSupported) missing.push("No device-education (99453) record");
  if (daysWithReadings < rules.deviceSupply.minBillableDays)
    missing.push(
      `${daysWithReadings} transmission day(s) — ${rules.deviceSupply.insufficientMessage}; device supply (99445/99454) not billable this month (99453 unaffected)`
    );
  if (!testA)
    missing.push(
      `Data Review + Interaction time ${dataReviewMinutes} min — under ${minTier} min; no management code (99470/99457) supported`
    );
  if (testA && requiresInteractive && testB !== true)
    missing.push(
      testB === false
        ? `${baseTier.code} test (b) FAILED — no live interactive communication this month (data review alone does not qualify)`
        : // testB === null: missing evidence, NOT a failure. Never state
          // under-claiming as fact — this is what the whole investigation turned on.
          `${baseTier.code} test (b) NOT DETERMINED — ${testBBasis}`
    );
  if (uncategorizedMinutes > 0)
    missing.push(
      `${uncategorizedMinutes} min of uncategorised ("other") time counted toward Data Review + Interaction — review categorisation`
    );

  // Per-code date of service = "the date the threshold was met" (not month-end).
  // The note shows one Date of Service; the biller confirms which. Until then the
  // top-level value is the PRIMARY billable code's date; every code carries its
  // own date under `billing`.
  const primaryDos =
    (managementDetails[0] && managementDetails[0].date_of_service) ||
    deviceSupplyDos ||
    (setupSupported ? setupDos : null) ||
    win.end;

  return {
    month: win.label,
    period: { start: win.start, end: win.end },
    // PRIMARY date of service; per-code dates are under `billing` (biller
    // confirms which appears on the note itself).
    date_of_service: primaryDos,
    patient: {
      id: p.id,
      name: p.name,
      date_of_birth: p.date_of_birth || null,
      mrn: p.mrn || null,
      enrolled: !!p.has_profile,
      enrolled_at: p.enrolled_at || null,
      program_status: p.program_status || null,
    },
    // Single-clinician assumption; `multiple` flags the confirm-the-biller case.
    provider: { clinicians: team, multiple: multipleProviders },
    consent,
    devices,
    device_education: setups,
    monitoring: {
      days_with_readings: daysWithReadings,
    },
    vitals: {
      bp_systolic: v.n ? { min: num(v.sys_min), max: num(v.sys_max), avg: num(v.sys_avg) } : null,
      bp_diastolic: v.n ? { min: num(v.dia_min), max: num(v.dia_max), avg: num(v.dia_avg) } : null,
      heart_rate: v.n ? { min: num(v.hr_min), max: num(v.hr_max), avg: num(v.hr_avg) } : null,
      reading_count: Number(v.n) || 0,
    },
    // The communication SUMMARY is a provider synthesis — it stays blank. We
    // only surface a derived hint of which channels were used; the raw call log
    // lives under `reference` as read-only backing.
    communication: {
      methods: calls.length ? ["phone"] : [],
    },
    // Template TIME DOCUMENTATION section — two buckets. Only Data Review +
    // Interaction counts toward 99457/99458.
    time_documentation: {
      setup_education_minutes: setupEducationMinutes,
      data_review_interaction_minutes: dataReviewMinutes,
      uncategorized_minutes: uncategorizedMinutes, // "other"; flagged in `missing`
      total_minutes: totalMinutes,
      by_category: byCategory,
    },
    billing: {
      // 99453 — once per patient per device type; independent of transmission
      // days. DOS is the setup event.
      setup: setupSupported
        ? { code: rules.setup.code, date_of_service: setupDos }
        : { code: null, date_of_service: null },
      // 99445/99454 — device supply by transmission-day band; DOS = the date the
      // day-count crossed the band threshold.
      device_supply: deviceSupply, // includes code, days, reason, date_of_service
      // 99470/99457 (+99458 add-ons). base_code is the mutually-exclusive tier;
      // codes[] stays a flat string list (99458 may repeat); code_details carries
      // the per-instance threshold-met date of service.
      management: {
        codes: managementCodes,
        code_details: managementDetails,
        base_code: baseTier ? baseTier.code : null,
        minutes: dataReviewMinutes,
        additional_units_99458: additionalUnits,
        interactive, // test (a)/(b) detail incl. which failed + whether (b) required
      },
    },
    // Template attestation text — PENDING final compliance wording; sourced from
    // config so the PDF layout is untouched when it's swapped.
    attestation: rules.attestation,
    // READ-ONLY history for the month, shown beside the blank fields so the
    // signing provider can see what was documented without leaving the form.
    // This is explicitly NOT the assessment/summary — never folded into a
    // signed clinical field.
    reference: {
      clinical_notes: priorNotes, // provider notes documented this month (head of chain)
      calls, // the month's call log (direction / outcome / note / date)
    },
    missing,
    // Manual checks the SYSTEM CANNOT perform — surfaced so the note never
    // implies it verified something it didn't (or that it's a submittable claim).
    compliance_checks: [
      "No-conflicting-codes check is OUTSIDE this system: confirm no overlapping RTM or Home Health codes were billed for this same period before submission.",
      "No ICD-10 diagnosis code on this note (not yet modelled). A diagnosis code is required on the claim — the biller must add it. This note is NOT a submittable claim on its own.",
    ],
    // Clinical judgment is intentionally absent — the provider fills it.
    clinical: null,
  };
}

module.exports = { getRpmNote };
