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
const {
  createCall,
  listCalls,
  correctCall,
} = require("../controllers/callDoc.controller");
const {
  createNote,
  listNotes,
  correctNote,
} = require("../controllers/clinicalNote.controller");
const { listStaff } = require("../controllers/careStaff.controller");

// Who may log/read clinical time, calls, and notes. Patients never. care_manager IS
// clinical staff — logging call/RPM-management time as themselves is the whole point of
// the role (99457 clinical-staff time), so it must be able to log calls, time, and notes.
// Per-patient access is enforced downstream (canAccessPatient: org-wide for care_manager).
const CLINICAL_STAFF = ["clinician", "admin", "super-admin", "care_manager"];

// Staff-name lookup for attribution. Org-scoped but NOT patient-linked, so it
// uses resolveOrgScope without scopePatientParam.
router.get(
  "/staff",
  authRequired,
  requireRole(...CLINICAL_STAFF),
  resolveOrgScope,
  listStaff
);

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

// --- Part 4: patient call documentation ---
router.post(
  "/patients/:patientId/calls",
  authRequired,
  requireRole(...CLINICAL_STAFF),
  resolveOrgScope,
  scopePatientParam("patientId"),
  createCall
);

router.get(
  "/patients/:patientId/calls",
  authRequired,
  requireRole(...CLINICAL_STAFF),
  resolveOrgScope,
  scopePatientParam("patientId"),
  listCalls
);

router.post(
  "/patients/:patientId/calls/:id/correct",
  authRequired,
  requireRole(...CLINICAL_STAFF),
  resolveOrgScope,
  scopePatientParam("patientId"),
  correctCall
);

// --- Part 5: clinical notes ---
router.post(
  "/patients/:patientId/notes",
  authRequired,
  requireRole(...CLINICAL_STAFF),
  resolveOrgScope,
  scopePatientParam("patientId"),
  createNote
);

router.get(
  "/patients/:patientId/notes",
  authRequired,
  requireRole(...CLINICAL_STAFF),
  resolveOrgScope,
  scopePatientParam("patientId"),
  listNotes
);

router.post(
  "/patients/:patientId/notes/:id/correct",
  authRequired,
  requireRole(...CLINICAL_STAFF),
  resolveOrgScope,
  scopePatientParam("patientId"),
  correctNote
);

module.exports = router;
