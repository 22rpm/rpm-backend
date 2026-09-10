// controllers/conditions.controller.js
//
// ICD-10-CM condition search for the conditions picker. Reference data, no PHI. Thin —
// the search logic (code-vs-name, dot normalization, billable filtering) lives in the
// service. Always 200: an empty/degraded result is a valid state, not an error — the
// client falls back to free text, which is a first-class path (same as drugSearch).

const icd10 = require("../services/icd10.service");

async function searchConditions(req, res) {
  try {
    const result = await icd10.searchConditions(req.query.q);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Condition search failed" });
  }
}

module.exports = { searchConditions };
