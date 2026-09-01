// routes/medications.routes.js
//
// Medications feature (patient-reported; NOT prescribing). Step 2 wires only the
// RxNorm drug-autocomplete endpoints. Patient-entry (step 3) and clinician
// confirmation (step 4) routes will be added to this same router.
const express = require("express");
const router = express.Router();
const { authRequired, requireRole } = require("../middleware/auth");
const { resolveOrgScope } = require("../middleware/orgScope");
const { drugSearch, ndcLookup, cacheStatus, refreshCache } = require("../controllers/rxnorm.controller");
const {
  createMyMedication,
  listMyMedications,
  updateMyMedication,
  deleteMyMedication,
  getPatientMedications,
  confirmMedication,
  rejectMedication,
} = require("../controllers/medication.controller");

// Autocomplete + NDC lookup. PUBLIC reference data (RxNorm) — no PHI, no patient
// identifiers, no org scoping. Deliberately NOT authRequired: autocomplete must not
// depend on session/cookie state (a flaky cookie previously made it silently return
// nothing). The service enforces a minimum query length and result cap; the client
// should debounce.
router.get("/drug-search", drugSearch);

// Barcode / printed-NDC path: NDC -> exact drug (name, strength, form). Public, same
// rationale as drug-search.
router.get("/ndc/:ndc", ndcLookup);

// Ops: cache freshness (last refresh, age, stale flag). Staff only.
router.get("/rxnorm/status", authRequired, requireRole("super-admin", "admin"), cacheStatus);

// Ops: refresh the cached snapshot from RxNav. Super-admin only; also runnable as a
// CLI (scripts/refreshRxNormCache.js) for scheduled refreshes.
router.post("/rxnorm/refresh", authRequired, requireRole("super-admin"), refreshCache);

// --- Patient entry (step 3). A patient manages their OWN reported medications. ---
// Everything created here is `unconfirmed`; a clinician confirms later (step 4).
router.get("/mine", authRequired, listMyMedications);
router.post("/", authRequired, createMyMedication);
router.patch("/:id", authRequired, updateMyMedication);
router.delete("/:id", authRequired, deleteMyMedication);

// --- Clinician confirmation (step 4). ---
// READ: org-wide roles + assigned clinician can see a patient's list (visibility via
// canAccessPatient in the service).
router.get("/patient/:patientId", authRequired, resolveOrgScope, getPatientMedications);
// CONFIRM / REJECT: CLINICIAN-ONLY — the same gate as signing the note. A care_manager
// can read the list but confirming what a patient is taking is a clinical judgment.
// canAccessPatient (assignment) is re-checked in the service.
router.patch("/:id/confirm", authRequired, resolveOrgScope, requireRole("clinician"), confirmMedication);
router.patch("/:id/reject", authRequired, resolveOrgScope, requireRole("clinician"), rejectMedication);

module.exports = router;
