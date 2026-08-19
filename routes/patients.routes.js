// routes/patients.routes.js
//
// Staff-facing patient management (plural — distinct from the patient-app
// `/api/patient` singular). Enrollment now; the worklist will live here later.
const express = require("express");
const router = express.Router();
const { authRequired, requireRole } = require("../middleware/auth");
const { resolveOrgScope } = require("../middleware/orgScope");
const { enrollPatient } = require("../controllers/patientEnrollment.controller");

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

module.exports = router;
