// services/billingSummary.service.js
//
// Roster-wide RPM billing overview (§ billing view). The one rule: the numbers here MUST
// come from the SAME determination the note uses — never a parallel query — or the
// overview could say "billable" where the note says otherwise, which is worse than no
// overview. So this loops the note's own getRpmNote() per patient and reads signed state
// via the note's own getSignedHead(). No billing logic lives here; it only groups and
// derives a display state.
//
// (There is no bulk determination service, by design. If this ever needs to scale, cache
// getRpmNote's output — never reimplement it.)

const db = require("../config/db");
const rules = require("../config/rpmBillingRules");
const { getRpmNote } = require("./rpmNote.service");
const { getSignedHead } = require("./rpmNoteSign.service");

// Primary billing thresholds for the display (the note's own config). 16 days = the full
// 99454 band; a 2-15 day month still bills 99445 (short period) — the codes column shows
// which. 20 min = the 99457 base tier.
const DAYS_THRESHOLD = (rules.deviceSupply.bands.find((b) => b.code === "99454") || {}).minDays || 16;
const TIME_THRESHOLD =
  (rules.managementTime.tiers.find((t) => t.code === "99457") || {}).minMinutes || 20;

// Patient ids in scope: the org's patients; a clinician sees only their assigned panel
// (org-wide roles see all), mirroring the worklist.
async function patientIdsInScope(orgScope, userId, isClinicianOnly) {
  const params = [orgScope];
  let mine = "";
  if (isClinicianOnly) {
    mine =
      "AND EXISTS (SELECT 1 FROM patient_doctor_assignments pda WHERE pda.patient_id = u.id AND pda.doctor_id = ?)";
    params.push(userId);
  }
  const [rows] = await db.query(
    `SELECT u.id FROM users u
       JOIN role r ON r.user_id = u.id AND r.role_type = 'patient'
      WHERE u.organization_id = ? ${mine}
      ORDER BY u.name ASC`,
    params
  );
  return rows.map((r) => r.id);
}

function flatCodes(note) {
  const codes = [];
  if (note.billing.setup && note.billing.setup.code) codes.push(note.billing.setup.code);
  if (note.billing.device_supply && note.billing.device_supply.code)
    codes.push(note.billing.device_supply.code);
  codes.push(...(note.billing.management.codes || [])); // 99457 + 99458 repeats
  return codes;
}

// Display state (drives sort + badge). Signing is a note action; this only reports.
//   signed      — a signed head note exists for the month
//   unsigned    — data supports code(s) AND consent is on record → ready to sign
//   blocked     — data supports code(s) but a prerequisite (consent) bars billing
//   not_billable— thresholds not met; nothing supported
function deriveState(note, signed) {
  if (signed) return "signed";
  const codes = flatCodes(note);
  if (codes.length > 0) return note.consent.obtained ? "unsigned" : "blocked";
  return "not_billable";
}

async function getBillingSummary({ orgScope, userId, role, month }) {
  const isClinicianOnly = role === "clinician"; // org-wide roles see the whole clinic
  const ids = await patientIdsInScope(orgScope, userId, isClinicianOnly);

  const patients = [];
  for (const id of ids) {
    // The determination — the exact function the note uses.
    const note = await getRpmNote({ patientId: id, orgScope, month });
    const signed = await getSignedHead({ patientId: id, orgScope, month });
    const codes = flatCodes(note);
    patients.push({
      patient_id: note.patient.id,
      name: note.patient.name,
      mrn: note.patient.mrn,
      days_with_readings: note.monitoring.days_with_readings,
      days_threshold: DAYS_THRESHOLD,
      data_review_minutes: note.time_documentation.data_review_interaction_minutes,
      time_threshold: TIME_THRESHOLD,
      provider_minutes: note.time_documentation.provider_minutes,
      clinical_staff_minutes: note.time_documentation.clinical_staff_minutes,
      codes,
      signed: signed ? { by: signed.signed_by_name || null, at: signed.signed_at_iso || signed.signed_at || null } : null,
      state: deriveState(note, signed),
      // The note's OWN missing[] text — verbatim, so the overview and note never disagree
      // and hedged wording (e.g. "confirm the supervision arrangement supports billing it")
      // is preserved rather than restated as settled.
      reasons: note.missing || [],
    });
  }
  return { month, days_threshold: DAYS_THRESHOLD, time_threshold: TIME_THRESHOLD, patients };
}

module.exports = { getBillingSummary };
