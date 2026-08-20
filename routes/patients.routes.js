// routes/patients.routes.js
//
// Staff-facing patient management (plural — distinct from the patient-app
// `/api/patient` singular). Enrollment now; the worklist will live here later.
const express = require("express");
const router = express.Router();
const { authRequired, requireRole } = require("../middleware/auth");
const { resolveOrgScope, scopePatientParam } = require("../middleware/orgScope");
const {
  enrollPatient,
  getEnrollmentOptions,
} = require("../controllers/patientEnrollment.controller");
const { getWorklist } = require("../controllers/patientWorklist.controller");
const {
  getPatientForEdit,
  updatePatient,
} = require("../controllers/patientEdit.controller");
const { getRpmNote } = require("../controllers/rpmNote.controller");

const staffRoles = requireRole("clinician", "admin", "super-admin");

// POST /api/patients — enroll a patient into the caller's organization
// (super-admin passes ?organizationId=). Not patient-linked (creating a new
// patient), so resolveOrgScope without scopePatientParam.
router.post(
  "/",
  authRequired,
  requireRole("clinician", "admin", "super-admin"),
  resolveOrgScope,
  enrollPatient
);

// GET /api/patients/enrollment-options — lookups for the enrollment form:
// active payers + active device types (global) and the org-scoped clinician
// roster. Same auth + scope as the POST (super-admin passes ?organizationId=).
router.get(
  "/enrollment-options",
  authRequired,
  requireRole("clinician", "admin", "super-admin"),
  resolveOrgScope,
  getEnrollmentOptions
);

// GET /api/patients/worklist?month=YYYY-MM&mine=true — the staff worklist for
// the caller's org (§3.2). month defaults to the current month; mine filters to
// the caller's panel (a filter, not an authorization boundary — a clinician may
// still request the whole clinic). Super-admin passes ?organizationId=.
router.get(
  "/worklist",
  authRequired,
  requireRole("clinician", "admin", "super-admin"),
  resolveOrgScope,
  getWorklist
);

// Patient-scoped routes come LAST so the static paths above (/enrollment-options,
// /worklist) are matched first and not swallowed by the :patientId param.
// scopePatientParam 404s a patient outside the caller's org.
//
// GET /api/patients/:patientId — editable detail to prefill the edit form.
router.get(
  "/:patientId",
  authRequired,
  staffRoles,
  resolveOrgScope,
  scopePatientParam("patientId"),
  getPatientForEdit
);

// PATCH /api/patients/:patientId — upsert profile + conditions + care team.
// Creates patient_profiles when absent. enrolled_at changes are audited.
router.patch(
  "/:patientId",
  authRequired,
  staffRoles,
  resolveOrgScope,
  scopePatientParam("patientId"),
  updatePatient
);

// GET /api/patients/:patientId/rpm-note?month=YYYY-MM — read-only pre-fill for
// the RPM monthly note. Computes what we have; never fills clinical judgment.
router.get(
  "/:patientId/rpm-note",
  authRequired,
  staffRoles,
  resolveOrgScope,
  scopePatientParam("patientId"),
  getRpmNote
);

module.exports = router;
