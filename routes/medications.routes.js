// routes/medications.routes.js
//
// Medications feature (patient-reported; NOT prescribing). Step 2 wires only the
// RxNorm drug-autocomplete endpoints. Patient-entry (step 3) and clinician
// confirmation (step 4) routes will be added to this same router.
const express = require("express");
const router = express.Router();
const { authRequired, requireRole } = require("../middleware/auth");
const { drugSearch, cacheStatus, refreshCache } = require("../controllers/rxnorm.controller");

// Autocomplete. Any authenticated user (a patient searching for their medication).
// Reference data only — no org scoping, no PHI. The client should debounce; the
// service enforces a minimum query length and result cap.
router.get("/drug-search", authRequired, drugSearch);

// Ops: cache freshness (last refresh, age, stale flag). Staff only.
router.get("/rxnorm/status", authRequired, requireRole("super-admin", "admin"), cacheStatus);

// Ops: refresh the cached snapshot from RxNav. Super-admin only; also runnable as a
// CLI (scripts/refreshRxNormCache.js) for scheduled refreshes.
router.post("/rxnorm/refresh", authRequired, requireRole("super-admin"), refreshCache);

module.exports = router;
