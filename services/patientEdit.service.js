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
    `SELECT DATE_FORMAT(date_of_birth, '%Y-%m-%d') AS date_of_birth,
            DATE_FORMAT(enrolled_at, '%Y-%m-%d') AS enrolled_at,
            program_status, insurance_payer_id, comments, mrn
       FROM patient_profiles WHERE user_id = ?`,
    [patientId]
  );
  const [conds] = await db.query(
    "SELECT name FROM patient_conditions WHERE patient_id = ? ORDER BY name",
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
    comments: p.comments ?? null,
    mrn: p.mrn ?? null,
    conditions: conds.map((c) => c.name),
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

  const careTeam = data.care_team;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [cur] = await conn.query(
      "SELECT DATE_FORMAT(enrolled_at, '%Y-%m-%d') AS enrolled_at FROM patient_profiles WHERE user_id = ?",
      [patientId]
    );
    const prevEnrolledAt = cur.length ? cur[0].enrolled_at : null;
    const newEnrolledAt = data.enrolled_at || prevEnrolledAt || null;

    await conn.query(
      `INSERT INTO patient_profiles
         (user_id, date_of_birth, enrolled_at, program_status, insurance_payer_id, comments)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         date_of_birth = VALUES(date_of_birth),
         enrolled_at = VALUES(enrolled_at),
         program_status = VALUES(program_status),
         insurance_payer_id = VALUES(insurance_payer_id),
         comments = VALUES(comments),
         updated_at = NOW()`,
      [
        patientId,
        data.date_of_birth || null,
        newEnrolledAt,
        data.program_status,
        data.insurance_payer_id ?? null,
        data.comments || null,
      ]
    );

    // Conditions: replace-all (no history/billing significance).
    await conn.query("DELETE FROM patient_conditions WHERE patient_id = ?", [
      patientId,
    ]);
    if (data.conditions.length) {
      await conn.query(
        "INSERT INTO patient_conditions (patient_id, name) VALUES ?",
        [data.conditions.map((n) => [patientId, n])]
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

module.exports = { getPatientForEdit, updatePatient };
