// config/roles.js
//
// THE single source of truth for role names and role GATE GROUPS. Before this,
// the four-role clinical-staff list was written out in 4 files (staffRoles,
// CLINICAL_STAFF, two STAFFs) plus re-typed inline 5 times — adding a role meant
// editing ~22 hand-maintained lists, which is how care_manager took three rounds.
// Now: every requireRole gate imports a named group from here, so a new role is a
// one-line edit to the right group. The scattered role STRINGS are gone from the
// route files (enforced by scripts/check-role-gates.js).
//
// GROUPS ARE KEPT DISTINCT ON PURPOSE. These are not one mega-list — enroll
// deliberately excludes care_manager, consent is clinician+super-admin, signing
// and medication-confirm are clinician-only. Consolidation must PRESERVE those
// differences, not flatten them (the proof: scripts/audit-role-gates diff is empty).

// --- role names (use these instead of bare strings everywhere) ---
const ROLES = Object.freeze({
  SUPER_ADMIN: "super-admin",
  ADMIN: "admin",
  CARE_MANAGER: "care_manager",
  CLINICIAN: "clinician",
  PATIENT: "patient",
  // (The read-only multi-org BILLER role is added here in its own PR, on top of
  //  this consolidation — kept out of this change so it stays a pure no-op.)
});

const { SUPER_ADMIN, ADMIN, CARE_MANAGER, CLINICIAN, PATIENT } = ROLES;

// Every valid role (for the auth create-user enum). Order kept as the enum had it.
const ALL_ROLES = [ADMIN, CLINICIAN, CARE_MANAGER, PATIENT, SUPER_ADMIN];

// --- gate groups (each named for its MEANING) ---

// Clinical staff: may see/act on patients (log time/calls/notes, read worklist,
// enrollment lookups, notifications health). Patients never. The list that was
// duplicated 9 times.
const CLINICAL_STAFF = [CLINICIAN, ADMIN, SUPER_ADMIN, CARE_MANAGER];

// Visibility axis (patientAccess.isOrgWide): who sees ALL patients in the resolved
// org vs. only their assignments. Operational surfaces (alerts, device-data) key
// off this too — deliberately NOT the same as CLINICAL_STAFF (no clinician; a
// clinician is assignment-scoped). Keep this set tight: a role added here inherits
// alert + device-data visibility, which is why a future read-only role must NOT be
// added here just to grant it note/billing reads.
const ORG_WIDE_ROLES = [SUPER_ADMIN, ADMIN, CARE_MANAGER];

// Enrolling (creating) a patient — NOT care_manager (creating patients isn't their job).
const ENROLL_ROLES = [CLINICIAN, ADMIN, SUPER_ADMIN];

// Consent attestation — the attester must be authorized; org admin excluded.
const CONSENT_ROLES = [CLINICIAN, SUPER_ADMIN];

// Clinician-only clinical attestations: signing the note, confirming medications.
const CLINICIAN_ONLY = [CLINICIAN];

// Org/admin management.
const ADMIN_ROLES = [ADMIN, SUPER_ADMIN];
const ADMIN_OR_CLINICIAN = [ADMIN, SUPER_ADMIN, CLINICIAN];
const SUPER_ADMIN_ONLY = [SUPER_ADMIN];

module.exports = Object.freeze({
  ROLES,
  ALL_ROLES,
  CLINICAL_STAFF,
  ORG_WIDE_ROLES,
  ENROLL_ROLES,
  CONSENT_ROLES,
  CLINICIAN_ONLY,
  ADMIN_ROLES,
  ADMIN_OR_CLINICIAN,
  SUPER_ADMIN_ONLY,
});
