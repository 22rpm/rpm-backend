// routes/patients.routes.js
//
// Staff-facing patient management (plural — distinct from the patient-app
// `/api/patient` singular). Enrollment now; the worklist will live here later.
const express = require("express");
const router = express.Router();
const { authRequired, requireRole } = require("../middleware/auth");
const { resolveOrgScope } = require("../middleware/orgScope");
const {
  enrollPatient,
  getEnrollmentOptions,
} = require("../controllers/patientEnrollment.controller");
const { getWorklist } = require("../controllers/patientWorklist.controller");

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

module.exports = router;
