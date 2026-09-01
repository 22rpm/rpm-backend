// controllers/rxnorm.controller.js
//
// Drug autocomplete backed by RxNorm (medications step 2). Reference data only — no
// PHI. drugSearch is available to any authenticated user (a patient searching for
// their medication); status/refresh are ops endpoints gated by role in the route.

const rxnorm = require("../services/rxnorm.service");

async function drugSearch(req, res) {
  try {
    const result = await rxnorm.searchDrugs(req.query.q);
    // Always 200: an empty or degraded result is a valid state — the client falls
    // back to free text, which is a first-class path, not an error.
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Drug search failed" });
  }
}

// NDC -> exact drug (barcode / printed-NDC path). Reference data, no PHI. Returns
// { ok, result } where result is null when the NDC doesn't resolve — the client then
// falls back to the text picker. The result identifies the product only; the client
// must NOT prefill the patient's dose from the strength.
async function ndcLookup(req, res) {
  try {
    const result = await rxnorm.lookupNdc(req.params.ndc);
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "NDC lookup failed" });
  }
}

async function cacheStatus(req, res) {
  try {
    const status = await rxnorm.getCacheStatus();
    return res.status(200).json({ ok: true, status });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function refreshCache(req, res) {
  try {
    const result = await rxnorm.refreshCache();
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return res
      .status(502)
      .json({ ok: false, message: "RxNorm refresh failed", detail: String(err.message || err) });
  }
}

module.exports = { drugSearch, ndcLookup, cacheStatus, refreshCache };
