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

  // Monitoring: distinct transmission days (any device) + BP/HR summary (bp).
  const [[dayRow]] = [
    await db.query(
      `SELECT COUNT(DISTINCT DATE(created_at)) AS days
         FROM dev_data
        WHERE user_id = ? AND created_at >= ? AND created_at < ?`,
      [patientId, win.start, win.next]
    ),
  ].map((r) => r[0]);
  const daysWithReadings = Number(dayRow.days) || 0;
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

  // Time: head-of-chain time_entries in the month, grouped by category.
  const [timeRows] = await db.query(
    `SELECT t.activity_category, SUM(t.duration_seconds) AS secs
       FROM time_entries t
       LEFT JOIN time_entries s ON s.supersedes = t.id
      WHERE s.id IS NULL AND t.patient_id = ? AND t.organization_id = ?
        AND t.started_at >= ? AND t.started_at < ?
      GROUP BY t.activity_category`,
    [patientId, orgScope, win.start, win.next]
  );
  // Map each activity_category into the template's two TIME DOCUMENTATION
  // buckets. Only Data Review + Interaction counts toward the 20-min 99457/
  // 99458 threshold; Setup/Education backs 99453 (which is not time-gated).
  const setupCats = new Set(rules.timeBuckets.setup_education);
  const reviewCats = new Set(rules.timeBuckets.data_review_interaction);
  let setupSecs = 0;
  let reviewSecs = 0;
  let otherSecs = 0;
  const byCategory = {};
  for (const row of timeRows) {
    const secs = Number(row.secs || 0);
    byCategory[row.activity_category] = Math.round(secs / 60);
    if (setupCats.has(row.activity_category)) setupSecs += secs;
    else if (reviewCats.has(row.activity_category)) reviewSecs += secs;
    else {
      // uncategorised (e.g. "other") -> counts toward Data Review + Interaction,
      // but its presence is flagged so the provider can see it.
      reviewSecs += secs;
      otherSecs += secs;
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
  // Device SUPPLY (99445/99454). 0-1 days -> not billable, with a reason string
  // instead of a blank. Independent of 99453.
  const deviceSupplyBand = deviceSupplyForDays(daysWithReadings);
  const deviceSupply = deviceSupplyBand
    ? { code: deviceSupplyBand.code, days: daysWithReadings, reason: null }
    : { code: null, days: daysWithReadings, reason: rules.deviceSupply.insufficientMessage };

  // 99457 = TWO independent tests, both required (Quantix KEY RULE):
  //   (a) 20+ minutes of Data Review + Interaction time
  //   (b) >=1 LIVE interactive communication (phone/video/in person) this month
  const testA = dataReviewMinutes >= rules.managementTime.firstUnit.minMinutes;

  // (b) detection — interim modes because patient_calls.outcome is free text.
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
    const q = new Set(rules.interactiveRequirement.qualifyingOutcomes);
    const hit = calls.some((c) => c.outcome && q.has(c.outcome));
    testB = hit;
    testBBasis = hit
      ? "a call outcome indicates a live interaction"
      : "no call outcome indicates a live interaction";
  } else {
    // "unverifiable": calls exist but free-text outcome can't confirm a live
    // connection -> not auto-satisfied; provider must verify.
    testB = null;
    testBBasis = `${calls.length} call(s) logged, but outcome is free text — cannot confirm a live interaction; provider must verify`;
  }
  const interactive = {
    test_a_minutes_met: testA,
    test_b_live_interaction: testB,
    test_b_basis: testBBasis,
    detection_mode: mode,
  };

  // 99457 bills only when BOTH tests pass; unverifiable (null) is NOT a pass.
  // 99458 is an add-on: one per full additional 20 min beyond the first 20.
  const billable99457 = testA && testB === true;
  const managementCodes = [];
  let additionalUnits = 0;
  if (billable99457) {
    managementCodes.push(rules.managementTime.firstUnit.code);
    additionalUnits = Math.floor(
      (dataReviewMinutes - rules.managementTime.firstUnit.minMinutes) /
        rules.managementTime.additionalUnit.everyMinutes
    );
    for (let i = 0; i < additionalUnits; i++)
      managementCodes.push(rules.managementTime.additionalUnit.code);
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
      `Data Review + Interaction time ${dataReviewMinutes} min — under ${rules.managementTime.firstUnit.minMinutes} min; 99457 test (a) not met`
    );
  if (testA && testB !== true)
    missing.push(
      testB === false
        ? "99457 test (b) FAILED — no live interactive communication this month (data review alone does not qualify)"
        : `99457 test (b) UNVERIFIABLE — ${testBBasis}`
    );
  if (uncategorizedMinutes > 0)
    missing.push(
      `${uncategorizedMinutes} min of uncategorised ("other") time counted toward Data Review + Interaction — review categorisation`
    );

  return {
    month: win.label,
    period: { start: win.start, end: win.end },
    // CONFIRMED: date of service for the monthly codes is the last day of month.
    date_of_service: win.end,
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
      // 99445/99454 — device supply by transmission-day band; DOS = month end.
      device_supply: { ...deviceSupply, date_of_service: win.end },
      // 99457 (+99458 add-ons) — both tests must pass; DOS = month end.
      management: {
        codes: managementCodes, // [] when not billable
        minutes: dataReviewMinutes,
        additional_units_99458: additionalUnits,
        interactive, // test (a)/(b) detail incl. which failed
        date_of_service: win.end,
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
    // Clinical judgment is intentionally absent — the provider fills it.
    clinical: null,
  };
}

module.exports = { getRpmNote };
