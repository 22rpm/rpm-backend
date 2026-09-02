// services/patientAccess.js
//
// THE single definition of "may this user see/act on this patient" for the
// four-role model. Every gate that previously rolled its own
// "super-admin-vs-assignment" branch calls one of these instead, so the access
// rule lives in exactly one auditable place (role-model step 4).
//
// ============================================================================
// VISIBILITY ONLY. This file decides who can SEE/act on a patient. It does NOT
// decide RESPONSIBILITY or ROUTING — who gets paged for an alert, or who a
// patient's message is directed to. Those stay ASSIGNMENT-based and are decided
// elsewhere (alert_assignments, the message receiverId). A care_manager seeing a
// patient does NOT make them accountable for that patient's alerts. Never wire
// paging, SMS, or message routing through these functions — visibility and
// responsibility are different axes and conflating them is the mistake this
// separation exists to prevent.
// ============================================================================
//
// The rule (org-wide vs assignment):
//   - super-admin / admin / care_manager  -> org-wide: any patient in the org.
//   - clinician                            -> assigned patients only.
//   - anything else (e.g. patient)         -> no access.
const db = require("../config/db");

// Roles whose patient VISIBILITY is org-wide (not gated by assignment).
// care_manager is the org-wide clinical-staff monitor; admin/super-admin manage.
// Sourced from config/roles.js so the role set lives in ONE place (both the route
// gates and this visibility axis reference the same definition).
const { ORG_WIDE_ROLES: ORG_WIDE_LIST } = require("../config/roles");
const ORG_WIDE_ROLES = new Set(ORG_WIDE_LIST);

const roleOf = (user) => user?.role_type || user?.role || null;

function isOrgWide(user) {
  return ORG_WIDE_ROLES.has(roleOf(user));
}

// POINT CHECK — may this user access THIS patient, in this org scope?
//
// SELF-SUFFICIENT: it verifies the org boundary itself (patient's org ==
// orgScope) rather than trusting that scopePatientParam ran upstream. That way a
// caller that forgets the middleware cannot grant cross-org access — org-wide
// roles are org-wide, not global. `orgScope` is the caller's resolved scope
// (req.orgScope): for super-admin it's their selected org, for everyone else
// their own org — the same value scopePatientParam uses.
async function canAccessPatient(user, orgScope, patientId) {
  const role = roleOf(user);
  if (role !== "clinician" && !ORG_WIDE_ROLES.has(role)) return false;

  // Org boundary — enforced here, not merely assumed from middleware.
  const [prows] = await db.query(
    "SELECT organization_id FROM users WHERE id = ? LIMIT 1",
    [patientId]
  );
  if (!prows.length || String(prows[0].organization_id) !== String(orgScope)) {
    return false;
  }

  if (ORG_WIDE_ROLES.has(role)) return true;

  // clinician: within-org AND assigned.
  const [rows] = await db.query(
    "SELECT 1 FROM patient_doctor_assignments WHERE doctor_id = ? AND patient_id = ? LIMIT 1",
    [user.id, patientId]
  );
  return rows.length > 0;
}

// LIST SCOPE — a composable SQL fragment for the ASSIGNMENT layer of a patient
// list, to AND into the caller's WHERE. Org-wide roles add nothing; a clinician
// is restricted to assigned patients; others match nothing.
//
// CALLER MUST STILL APPLY THE ORG FILTER. Unlike the point check above, this
// fragment does NOT enforce org — for org-wide roles it returns "", so the
// caller's own `WHERE organization_id = orgScope` is the load-bearing boundary.
// Omit that filter and an org-wide role sees EVERY org. Every list endpoint here
// is org-scoped (resolveOrgScope + an org WHERE); keep it that way.
//
// `patientCol` is the FULLY-QUALIFIED patient-id column in the caller's query
// (e.g. "u.id") — a fixed internal identifier, never user input.
//   returns { clause: string, params: any[] }
function assignmentScope(user, patientCol) {
  if (isOrgWide(user)) return { clause: "", params: [] };
  if (roleOf(user) === "clinician") {
    return {
      clause: `AND EXISTS (SELECT 1 FROM patient_doctor_assignments pda
                            WHERE pda.patient_id = ${patientCol} AND pda.doctor_id = ?)`,
      params: [user.id],
    };
  }
  return { clause: "AND 1=0", params: [] };
}

module.exports = {
  ORG_WIDE_ROLES,
  isOrgWide,
  canAccessPatient,
  assignmentScope,
};
