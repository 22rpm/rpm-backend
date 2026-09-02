// services/patientEdit.service.js
//
// Edit an existing patient's profile + clinical fields. Distinct from enrollment
// (which creates the user + role): this UPSERTs patient_profiles because some
// patients predate enrollment and have no profile row at all. Demographics and
// clinical fields only — devices and consent are append-only ledgers with
// billing significance and are handled by their own actions, never overwritten
// here.
const db = require("../config/db");

function httpError(status, message) {
  const e = new Error(message);
  e.httpStatus = status;
  return e;
}

// Editable detail for the edit form. The profile row may not exist yet; return
// nulls (with has_profile:false) so the form opens and PATCH upserts. Dates are
// formatted to plain YYYY-MM-DD (no tz shift), as in the worklist.
// care_team is returned as [{id, name, status}] — not bare ids — so the edit
// form can show and preserve an assignment even when the clinician has dropped
// out of the active roster (the checkbox list is the active-in-org roster; a
// diff-based save would otherwise silently delete what it can't display).
// status, relative to the patient's org (orgScope):
//   active        — active clinician in this org (in the normal roster)
//   deactivated   — user.is_active = 0 (an HR event)
//   moved_org     — active, but now belongs to a different org (a scoping event)
//   not_clinician — active, this org, but no longer holds the clinician role
function careTeamStatus(m, orgScope) {
  if (!m.is_active) return "deactivated";
  if (Number(m.organization_id) !== Number(orgScope)) return "moved_org";
  if (m.role_type !== "clinician") return "not_clinician";
  return "active";
}

async function getPatientForEdit(patientId, orgScope) {
  const [u] = await db.query(
    `SELECT u.id, u.name
       FROM users u
       JOIN role r ON r.user_id = u.id AND r.role_type = 'patient'
      WHERE u.id = ?`,
    [patientId]
  );
  if (!u.length) throw httpError(404, "Patient not found");

  const [prof] = await db.query(
    `SELECT DATE_FORMAT(pp.date_of_birth, '%Y-%m-%d') AS date_of_birth,
            DATE_FORMAT(pp.enrolled_at, '%Y-%m-%d') AS enrolled_at,
            pp.program_status, pp.insurance_payer_id, pp.secondary_insurance_payer_id,
            pp.comments, pp.mrn, pp.is_dialysis, pp.dialysis_clinic,
            pp.nkda,
            DATE_FORMAT(pp.allergies_reviewed_at, '%Y-%m-%d') AS allergies_reviewed_at,
            rb.name AS allergies_reviewed_by_name
       FROM patient_profiles pp
       LEFT JOIN users rb ON rb.id = pp.allergies_reviewed_by
      WHERE pp.user_id = ?`,
    [patientId]
  );
  const [conds] = await db.query(
    "SELECT name, icd10_code FROM patient_conditions WHERE patient_id = ? ORDER BY name",
    [patientId]
  );
  const [allergyRows] = await db.query(
    "SELECT substance FROM patient_allergies WHERE patient_id = ? ORDER BY substance",
    [patientId]
  );
  const [team] = await db.query(
    `SELECT u.id, u.name, u.is_active, u.organization_id, r.role_type
       FROM patient_doctor_assignments pda
       JOIN users u ON u.id = pda.doctor_id
       LEFT JOIN role r ON r.user_id = u.id
      WHERE pda.patient_id = ?
      ORDER BY u.name`,
    [patientId]
  );

  const p = prof[0] || {};
  return {
    id: u[0].id,
    name: u[0].name,
    date_of_birth: p.date_of_birth ?? null,
    enrolled_at: p.enrolled_at ?? null,
    program_status: p.program_status ?? null,
    insurance_payer_id: p.insurance_payer_id ?? null,
    secondary_insurance_payer_id: p.secondary_insurance_payer_id ?? null,
    comments: p.comments ?? null,
    mrn: p.mrn ?? null,
    is_dialysis: !!p.is_dialysis,
    dialysis_clinic: p.dialysis_clinic ?? null,
    conditions: conds.map((c) => ({ name: c.name, icd10_code: c.icd10_code ?? null })),
    // Drug allergies + the tri-state the profile banner needs. `allergy_status` is
    // derived server-side so the client can't accidentally render NKDA (green,
    // "safe to rely") when nothing was actually recorded:
    //   has_allergies (substances) > nkda (attested) > none_recorded (default).
    allergies: allergyRows.map((r) => r.substance),
    nkda: !!p.nkda,
    allergy_status: allergyRows.length
      ? "has_allergies"
      : p.nkda
      ? "nkda"
      : "none_recorded",
    allergies_reviewed_at: p.allergies_reviewed_at ?? null,
    allergies_reviewed_by_name: p.allergies_reviewed_by_name ?? null,
    care_team: team.map((m) => ({
      id: m.id,
      name: m.name,
      status: careTeamStatus(m, orgScope),
    })),
    has_profile: prof.length > 0,
  };
}

// Upsert profile + replace conditions + diff care team, transactionally.
// Returns { enrolledAtChanged, from, to } so the caller can audit the enrolment
// change (a distinct billing-period compliance event).
async function updatePatient({ patientId, orgScope, actorId, data }) {
  // Re-check role: scopePatientParam already confirmed org membership, but not
  // that the target is a patient — never write a patient_profiles row for a
  // clinician/admin.
  const [u] = await db.query(
    "SELECT r.role_type FROM users u JOIN role r ON r.user_id = u.id WHERE u.id = ?",
    [patientId]
  );
  if (!u.length) throw httpError(404, "Patient not found");
  if (u[0].role_type !== "patient")
    throw httpError(400, "Target user is not a patient");

  if (data.insurance_payer_id != null) {
    const [pay] = await db.query(
      "SELECT id FROM insurance_payers WHERE id = ? AND is_active = 1",
      [data.insurance_payer_id]
    );
    if (!pay.length)
      throw httpError(400, "Unknown or inactive insurance_payer_id");
  }
  if (data.secondary_insurance_payer_id != null) {
    if (data.secondary_insurance_payer_id === data.insurance_payer_id)
      throw httpError(400, "secondary insurance cannot be the same as primary");
    const [pay2] = await db.query(
      "SELECT id FROM insurance_payers WHERE id = ? AND is_active = 1",
      [data.secondary_insurance_payer_id]
    );
    if (!pay2.length)
      throw httpError(400, "Unknown or inactive secondary_insurance_payer_id");
  }

  const careTeam = data.care_team;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [cur] = await conn.query(
      "SELECT DATE_FORMAT(enrolled_at, '%Y-%m-%d') AS enrolled_at, mrn, is_dialysis, dialysis_clinic FROM patient_profiles WHERE user_id = ?",
      [patientId]
    );
    const prevEnrolledAt = cur.length ? cur[0].enrolled_at : null;
    const newEnrolledAt = data.enrolled_at || prevEnrolledAt || null;
    // MRN: if the key is present, honor it (including an explicit clear to null);
    // if absent (older client), keep the existing value rather than wiping it.
    const prevMrn = cur.length ? cur[0].mrn : null;
    // undefined (key absent) -> keep existing; null or "" -> clear; else trim.
    // Guard: String(null) is the literal "null", which must not be stored.
    let newMrn;
    if (data.mrn === undefined) newMrn = prevMrn;
    else if (data.mrn === null) newMrn = null;
    else newMrn = String(data.mrn).trim() || null;

    // Dialysis flag + clinic: keep-if-absent (like mrn), so an older client that omits
    // the keys doesn't wipe them.
    const prevDialysis = cur.length ? cur[0].is_dialysis : 0;
    const newIsDialysis =
      data.is_dialysis === undefined ? (prevDialysis ? 1 : 0) : data.is_dialysis ? 1 : 0;
    const prevClinic = cur.length ? cur[0].dialysis_clinic : null;
    let newClinic;
    if (data.dialysis_clinic === undefined) newClinic = prevClinic;
    else if (data.dialysis_clinic === null) newClinic = null;
    else newClinic = String(data.dialysis_clinic).trim().slice(0, 255) || null;

    await conn.query(
      `INSERT INTO patient_profiles
         (user_id, date_of_birth, enrolled_at, program_status, insurance_payer_id,
          secondary_insurance_payer_id, comments, mrn, is_dialysis, dialysis_clinic)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         date_of_birth = VALUES(date_of_birth),
         enrolled_at = VALUES(enrolled_at),
         program_status = VALUES(program_status),
         insurance_payer_id = VALUES(insurance_payer_id),
         secondary_insurance_payer_id = VALUES(secondary_insurance_payer_id),
         comments = VALUES(comments),
         mrn = VALUES(mrn),
         is_dialysis = VALUES(is_dialysis),
         dialysis_clinic = VALUES(dialysis_clinic),
         updated_at = NOW()`,
      [
        patientId,
        data.date_of_birth || null,
        newEnrolledAt,
        data.program_status,
        data.insurance_payer_id ?? null,
        data.secondary_insurance_payer_id ?? null,
        data.comments || null,
        newMrn,
        newIsDialysis,
        newClinic,
      ]
    );

    // Conditions: replace-all (no history/billing significance). Each carries an
    // optional curated ICD-10 code (null = free text).
    await conn.query("DELETE FROM patient_conditions WHERE patient_id = ?", [
      patientId,
    ]);
    if (data.conditions.length) {
      await conn.query(
        "INSERT INTO patient_conditions (patient_id, name, icd10_code) VALUES ?",
        [data.conditions.map((c) => [patientId, c.name, c.icd10_code || null])]
      );
    }

    // Care team: diff, so unchanged assignments keep their created_at/assigned_by.
    const [existing] = await conn.query(
      "SELECT doctor_id FROM patient_doctor_assignments WHERE patient_id = ?",
      [patientId]
    );
    const existingIds = new Set(existing.map((r) => r.doctor_id));
    const nextIds = [...new Set(careTeam)];
    const toRemove = [...existingIds].filter((id) => !nextIds.includes(id));
    const toAdd = nextIds.filter((id) => !existingIds.has(id));

    // Only NEWLY added members must be active clinicians in this org. Members
    // already assigned are preserved even if they have since been deactivated or
    // moved orgs — those are shown (and kept checked) in the edit form, and
    // removing one is an explicit uncheck that lands in toRemove, never a silent
    // drop. (Alert routing keys off these assignments, so a silent drop could
    // strand a patient's alerts — see ORG_CONTEXT_FOLLOWUPS.)
    if (toAdd.length) {
      const [valid] = await conn.query(
        `SELECT u.id FROM users u JOIN role r ON r.user_id = u.id
          WHERE u.id IN (?) AND r.role_type = 'clinician'
            AND u.is_active = 1 AND u.organization_id = ?`,
        [toAdd, orgScope]
      );
      if (valid.length !== toAdd.length)
        throw httpError(
          400,
          "newly assigned care_team members must be active clinicians in this organization"
        );
    }
    if (toRemove.length) {
      await conn.query(
        "DELETE FROM patient_doctor_assignments WHERE patient_id = ? AND doctor_id IN (?)",
        [patientId, toRemove]
      );
    }
    if (toAdd.length) {
      await conn.query(
        "INSERT INTO patient_doctor_assignments (patient_id, doctor_id, assigned_by) VALUES ?",
        [toAdd.map((id) => [patientId, id, actorId])]
      );
    }

    await conn.commit();
    return {
      enrolledAtChanged: (prevEnrolledAt || null) !== (newEnrolledAt || null),
      from: prevEnrolledAt || null,
      to: newEnrolledAt || null,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Record drug-allergy status for a patient (the profile banner's write path).
// This is a DELIBERATE act — the ONLY thing that moves a patient off "not
// recorded" — so it always stamps allergies_reviewed_at/by. NKDA and a substance
// list are mutually exclusive; a non-empty list wins (nkda forced false).
//   substances non-empty -> those substances, nkda 0
//   nkda === true         -> no substances, nkda 1 (attested "no known allergies")
//   both empty            -> clears back to "not recorded" (rows gone, nkda 0),
//                            but still stamps reviewed (someone looked and cleared it)
// Upserts patient_profiles because some patients predate enrollment (no row yet);
// only user_id lacks a column default, so the minimal insert is safe.
async function recordAllergies({ patientId, orgScope, actorId, substances, nkda }) {
  const [u] = await db.query(
    "SELECT r.role_type FROM users u JOIN role r ON r.user_id = u.id WHERE u.id = ?",
    [patientId]
  );
  if (!u.length) throw httpError(404, "Patient not found");
  if (u[0].role_type !== "patient")
    throw httpError(400, "Target user is not a patient");

  const list = Array.isArray(substances)
    ? [...new Set(substances.map((s) => String(s).trim()).filter(Boolean))].slice(0, 50)
    : [];
  const finalNkda = list.length ? false : nkda === true;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO patient_profiles (user_id, nkda, allergies_reviewed_at, allergies_reviewed_by)
       VALUES (?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE
         nkda = VALUES(nkda),
         allergies_reviewed_at = VALUES(allergies_reviewed_at),
         allergies_reviewed_by = VALUES(allergies_reviewed_by),
         updated_at = NOW()`,
      [patientId, finalNkda ? 1 : 0, actorId]
    );
    await conn.query("DELETE FROM patient_allergies WHERE patient_id = ?", [
      patientId,
    ]);
    if (list.length) {
      await conn.query(
        "INSERT INTO patient_allergies (patient_id, substance, recorded_by) VALUES ?",
        [list.map((s) => [patientId, s, actorId])]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return {
    allergies: list,
    nkda: finalNkda,
    allergy_status: list.length ? "has_allergies" : finalNkda ? "nkda" : "none_recorded",
  };
}

// Latest-wins consent row for the READ-ONLY consent view. patient_consents is an
// append-only ledger — a withdrawal or re-consent is a new row — so the newest by
// date (then id) is the current state. Returns null when there is no consent on
// record (a billing-relevant state the caller must surface plainly, not as empty).
// obtained_by / supervising_provider are resolved to names for display.
async function getLatestConsent(patientId, orgScope) {
  const [rows] = await db.query(
    `SELECT c.status,
            DATE_FORMAT(c.consent_date, '%Y-%m-%d') AS consent_date,
            DATE_FORMAT(c.created_at, '%Y-%m-%d') AS recorded_at,
            c.method,
            c.notes,
            c.document_key,
            ob.name AS obtained_by_name,
            sp.name AS supervising_provider_name
       FROM patient_consents c
       LEFT JOIN users ob ON ob.id = c.obtained_by
       LEFT JOIN users sp ON sp.id = c.supervising_provider_id
      WHERE c.patient_id = ? AND c.organization_id = ?
      ORDER BY c.consent_date DESC, c.id DESC
      LIMIT 1`,
    [patientId, orgScope]
  );
  return rows[0] || null;
}

// Append a new consent EVENT to the patient_consents ledger (latest-wins; never
// UPDATE a prior row). obtained_by is the authenticated clinician, passed from
// the controller as actorId — NEVER client-supplied, so the audit answer to
// "who attested, and were they authorized" is unambiguous.
async function recordConsent({
  patientId,
  orgScope,
  actorId,
  status,
  consentDate,
  method,
  supervisingProviderId,
  notes,
}) {
  const [res] = await db.query(
    `INSERT INTO patient_consents
       (patient_id, organization_id, status, consent_date, method,
        obtained_by, supervising_provider_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      patientId,
      orgScope,
      status,
      consentDate,
      method,
      actorId,
      supervisingProviderId ?? null,
      notes ?? null,
    ]
  );
  return {
    id: res.insertId,
    patient_id: patientId,
    status,
    consent_date: consentDate,
    method,
    obtained_by: actorId,
    supervising_provider_id: supervisingProviderId ?? null,
  };
}

module.exports = {
  getPatientForEdit,
  updatePatient,
  recordAllergies,
  getLatestConsent,
  recordConsent,
};
