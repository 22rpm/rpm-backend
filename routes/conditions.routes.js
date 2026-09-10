// routes/conditions.routes.js
//
// Conditions picker — ICD-10-CM search. Reference data (public CMS dataset, no PHI), but
// this is a staff data-entry tool, so it sits behind authRequired (unlike the public
// medications drug-search, which patients also use). No org scoping needed — it's a
// lookup over reference data, not patient records.
const express = require("express");
const router = express.Router();
const { authRequired } = require("../middleware/auth");
const { searchConditions } = require("../controllers/conditions.controller");

// GET /api/conditions/search?q=  ->  { ok, results:[{code, code_raw, billable, label}], query_kind }
router.get("/search", authRequired, searchConditions);

module.exports = router;
