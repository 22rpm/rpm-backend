// routes/care.routes.js
//
// Care activity & time tracking. Part 2: manual time entry only (no timer, no
// calls, no notes, no timeline yet).
//
// Every route is patient-linked and therefore org-scoped:
//   authRequired -> requireRole -> resolveOrgScope -> scopePatientParam.
const express = require("express");
const router = express.Router();
const { authRequired, requireRole } = require("../middleware/auth");
const { resolveOrgScope, scopePatientParam } = require("../middleware/orgScope");
const {
  createTimeEntry,
  listTimeEntries,
  correctTimeEntry,
} = require("../controllers/care.controller");

// Who may log/read clinical time. Patients never.
const CLINICAL_STAFF = ["clinician", "admin", "super-admin"];

router.post(
  "/patients/:patientId/time-entries",
  authRequired,
  requireRole(...CLINICAL_STAFF),
  resolveOrgScope,
  scopePatientParam("patientId"),
  createTimeEntry
);

router.get(
  "/patients/:patientId/time-entries",
  authRequired,
  requireRole(...CLINICAL_STAFF),
  resolveOrgScope,
  scopePatientParam("patientId"),
  listTimeEntries
);

router.post(
  "/patients/:patientId/time-entries/:id/correct",
  authRequired,
  requireRole(...CLINICAL_STAFF),
  resolveOrgScope,
  scopePatientParam("patientId"),
  correctTimeEntry
);

module.exports = router;
