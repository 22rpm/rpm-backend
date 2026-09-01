// scripts/refreshRxNormCache.js
//
// Refresh the RxNorm autocomplete cache from RxNav displaynames. Run periodically —
// RxNorm publishes monthly, so ~monthly is the natural cadence:
//
//   node scripts/refreshRxNormCache.js
//
// Schedule it externally (cron / launchd / CI). The cache is NOT self-scheduling and
// NEVER auto-expires: if this never runs, autocomplete still works live against RxNav,
// and a drug missing from a stale cache simply falls through to live lookup or free
// text. See MEDICATIONS_DESIGN.md §1.

require("dotenv").config();
const pool = require("../config/db");
const { refreshCache } = require("../services/rxnorm.service");

(async () => {
  try {
    const result = await refreshCache();
    console.log(
      `RxNorm cache refreshed: ${result.terms} terms fetched, ${result.cacheCount} rows cached.`
    );
    process.exitCode = 0;
  } catch (err) {
    console.error("RxNorm cache refresh FAILED:", err.message || err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
