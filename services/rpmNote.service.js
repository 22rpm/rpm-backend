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

// "YYYY-MM" -> calendar-month window. (Note: 99454/99445 are technically per
// 30-day period; we use the selected calendar month for consistency with the
// worklist. The calendar-vs-30-day convention is a biller flag — see doc.)
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

// First band (most-days-first) whose minDays is met.
function deviceSupplyForDays(days) {
  if (!days || days <= 0) return null;
  for (const band of rules.deviceSupplyBands) {
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
  let setupSecs = 0;
  let mgmtSecs = 0;
  const byCategory = {};
  for (const row of timeRows) {
    const secs = Number(row.secs || 0);
    byCategory[row.activity_category] = Math.round(secs / 60);
    const bucket = rules.categoryContribution[row.activity_category] || "management";
    if (bucket === "setup") setupSecs += secs;
    else mgmtSecs += secs;
  }
  const setupMinutes = Math.round(setupSecs / 60);
  const managementMinutes = Math.round(mgmtSecs / 60);
  const totalMinutes = setupMinutes + managementMinutes;

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

  // Apply the configurable billing rules.
  const deviceSupply = deviceSupplyForDays(daysWithReadings);
  const managementCodes = [];
  if (managementMinutes >= rules.managementTime.firstUnit.minMinutes)
    managementCodes.push(rules.managementTime.firstUnit.code);
  if (managementMinutes >= rules.managementTime.additionalUnit.minMinutes)
    managementCodes.push(rules.managementTime.additionalUnit.code);
  const setupSupported = setups.length > 0;

  // Missing-data / billing flags (§3.9) — never a refusal.
  const missing = [];
  if (!p.has_profile) missing.push("No patient_profiles row — demographics unavailable");
  if (!p.date_of_birth) missing.push("No date of birth on record");
  if (!p.mrn) missing.push("No MRN on record");
  if (!team.length) missing.push("No care-team provider assigned");
  if (!consent.obtained) missing.push("Consent not on record");
  if (!devices.length) missing.push("No active device on record");
  if (!setupSupported) missing.push("No device-education (99453) record");
  if (daysWithReadings === 0) missing.push("Zero transmission days this month");
  if (managementMinutes < rules.managementTime.firstUnit.minMinutes)
    missing.push(
      `Management time ${managementMinutes} min — under ${rules.managementTime.firstUnit.minMinutes} min (99457 not yet supported)`
    );

  return {
    month: win.label,
    period: { start: win.start, end: win.end },
    patient: {
      id: p.id,
      name: p.name,
      date_of_birth: p.date_of_birth || null,
      mrn: p.mrn || null,
      enrolled: !!p.has_profile,
      enrolled_at: p.enrolled_at || null,
      program_status: p.program_status || null,
    },
    provider: team, // [{id,name}] — biller decides which is the billing provider
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
    time_documentation: {
      setup_minutes: setupMinutes,
      management_minutes: managementMinutes,
      total_minutes: totalMinutes,
      by_category: byCategory,
    },
    billing: {
      setup: setupSupported ? rules.setup.code : null,
      device_supply: deviceSupply
        ? { code: deviceSupply.code, days: daysWithReadings, pending: !!deviceSupply.pending }
        : null,
      management: managementCodes,
    },
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
