// services/patientAccess.js
//
// THE single definition of "may this user see/act on this patient" for the
// four-role model. Every gate that previously rolled its own
// "super-admin-vs-assignment" branch calls one of these instead, so the access
// rule lives in exactly one auditable place (role-model step 4).
//
// The rule has two axes that must not be conflated:
//   VISIBILITY (this file) — who can see a patient.
//   RESPONSIBILITY/ROUTING (assignment) — who is paged / who a message is
//     directed to. That stays assignment-based and is NOT decided here.
//
// Precondition: ORG membership is already enforced upstream by
// middleware/orgScope.scopePatientParam (and resolveOrgScope). These helpers
// decide only the ASSIGNMENT layer on top of that:
//   - super-admin / admin / care_manager  -> org-wide: any patient in their org.
//   - clinician                           -> assigned patients only.
//   - anything else (e.g. patient)        -> no access.
const db = require("../config/db");

// Roles whose patient VISIBILITY is org-wide (not gated by assignment).
// care_manager is the org-wide clinical-staff monitor; admin/super-admin manage.
const ORG_WIDE_ROLES = new Set(["super-admin", "admin", "care_manager"]);

const roleOf = (user) => user?.role_type || user?.role || null;

function isOrgWide(user) {
  return ORG_WIDE_ROLES.has(roleOf(user));
}

// POINT CHECK — may this user access THIS patient? Assumes org membership was
// already verified (scopePatientParam). Org-wide roles pass; a clinician must
// have a patient_doctor_assignments row; anyone else is denied.
async function canAccessPatient(user, patientId) {
  const role = roleOf(user);
  if (ORG_WIDE_ROLES.has(role)) return true;
  if (role === "clinician") {
    const [rows] = await db.query(
      "SELECT 1 FROM patient_doctor_assignments WHERE doctor_id = ? AND patient_id = ? LIMIT 1",
      [user.id, patientId]
    );
    return rows.length > 0;
  }
  return false;
}

// LIST SCOPE — a composable SQL fragment to AND into a patient-list WHERE.
// Org-wide roles add nothing (the caller's own org filter is the boundary);
// a clinician is restricted to assigned patients via EXISTS. `patientCol` is the
// FULLY-QUALIFIED patient-id column in the caller's query (e.g. "u.id"), a fixed
// internal identifier, never user input.
//   returns { clause: string, params: any[] }  — clause is "" for org-wide roles.
function assignmentScope(user, patientCol) {
  if (isOrgWide(user)) return { clause: "", params: [] };
  if (roleOf(user) === "clinician") {
    return {
      clause: `AND EXISTS (SELECT 1 FROM patient_doctor_assignments pda
                            WHERE pda.patient_id = ${patientCol} AND pda.doctor_id = ?)`,
      params: [user.id],
    };
  }
  // Non-clinical, non-org-wide (e.g. patient): match nothing.
  return { clause: "AND 1=0", params: [] };
}

module.exports = {
  ORG_WIDE_ROLES,
  isOrgWide,
  canAccessPatient,
  assignmentScope,
};
