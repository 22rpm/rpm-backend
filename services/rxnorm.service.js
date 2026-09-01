// services/rxnorm.service.js
//
// RxNorm drug autocomplete (medications step 2). NO PHI here — RxNorm is a public
// NLM/NIH reference dataset. NEVER attach a patient identifier to an RxNav request.
//
// Three-tier availability, in this order (see MEDICATIONS_DESIGN.md §1):
//   1. LIVE  — RxNav drugs.json?name=<q>. Returns an rxcui, so a match is a real,
//              verified match. This is what makes patient_medications.rxcui meaningful
//              and keeps the clinician's "not matched" flag a rare, real signal.
//   2. CACHE — local rxnorm_drugs snapshot, used only when RxNav is slow/down. A cache
//              row may have rxcui NULL (name-only, from displaynames); such a pick is
//              recorded UNMATCHED, exactly like free text.
//   3. FREE TEXT — the caller (patient app) can always submit a typed name with
//              rxcui = null. Submission NEVER depends on an RxNorm call.
//
// The endpoint returns 200 even when degraded/empty; free text is a client behavior,
// not an error path here.

const db = require("../config/db");

const RXNAV_BASE = "https://rxnav.nlm.nih.gov/REST";
const LIVE_TIMEOUT_MS = 2500; // a slow NIH API must not stall the patient
const REFRESH_TIMEOUT_MS = 30000; // the displaynames dump is large
const MIN_QUERY_LEN = 2; // bound load; client should also debounce
const MAX_RESULTS = 20;
const STALE_AFTER_DAYS = 90; // surfaced as a warning only; never disables the cache
// Term types a PATIENT should pick from: BN (brand name), SBD (branded drug w/
// strength+form), SCD (clinical/generic drug w/ strength+form). Excludes ingredients,
// packs (BPCK/GPCK) and dose-form-only concepts — noise a patient can't act on.
const KEEP_TTY = new Set(["BN", "SBD", "SCD"]);

// ---- small fetch helper with a hard timeout (Node 24 native fetch) ----
async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`RxNav ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Flatten RxNav drugGroup → [{ rxcui, name, tty }], dropping suppressed entries.
function parseDrugGroup(json) {
  const groups = json?.drugGroup?.conceptGroup || [];
  const out = [];
  const seen = new Set();
  for (const g of groups) {
    const props = g?.conceptProperties || [];
    for (const p of props) {
      if (!p || p.suppress === "Y") continue;
      if (!p.rxcui || seen.has(p.rxcui)) continue;
      seen.add(p.rxcui);
      out.push({ rxcui: String(p.rxcui), name: p.name, tty: p.tty || g.tty || null });
    }
  }
  return out;
}

// Opportunistically enrich the cache with verified (name + rxcui) rows so the
// fallback improves for the drugs patients actually use. Best-effort: never throws
// into the request path.
async function warmCache(results) {
  if (!results.length) return;
  const rows = results
    .filter((r) => r.name)
    .map((r) => [r.name, r.name.toLowerCase(), r.rxcui || null, r.tty || null, "live"]);
  if (!rows.length) return;
  try {
    await db.query(
      `INSERT INTO rxnorm_drugs (name, search_name, rxcui, tty, source)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         rxcui = VALUES(rxcui), tty = VALUES(tty), source = 'live'`,
      [rows]
    );
  } catch (_) {
    /* cache warming is best-effort; a failure must not affect the search result */
  }
}

async function searchCache(q) {
  const [rows] = await db.query(
    `SELECT name, rxcui, tty
       FROM rxnorm_drugs
      WHERE search_name LIKE ?
      ORDER BY (rxcui IS NOT NULL) DESC, CHAR_LENGTH(name) ASC
      LIMIT ?`,
    [`${q.toLowerCase()}%`, MAX_RESULTS]
  );
  return rows.map((r) => ({
    name: r.name,
    rxcui: r.rxcui || null,
    tty: r.tty || null,
    matched: r.rxcui != null,
  }));
}

// The autocomplete entry point. Returns { results, degraded, source }.
//   degraded=true  -> served from cache (RxNav unreachable); client should nudge
//                     "search is limited — you can type your medication name".
// Live drugs.json searches broadly across sources; results are filtered to the
// patient-facing term types (BN/SBD/SCD). drugs.json needs a fairly complete name
// (a partial like "lisin" returns 0), so when live yields nothing we fall to the
// local cache's PREFIX search — that's what makes partial typing autocomplete.
async function searchDrugs(query) {
  const q = (query || "").trim();
  if (q.length < MIN_QUERY_LEN) return { results: [], degraded: false, source: "none" };

  // Tier 1: live (all sources), keep only BN/SBD/SCD.
  try {
    const json = await fetchJson(
      `${RXNAV_BASE}/drugs.json?name=${encodeURIComponent(q)}`,
      LIVE_TIMEOUT_MS
    );
    const parsed = parseDrugGroup(json)
      .filter((r) => KEEP_TTY.has(r.tty))
      .slice(0, MAX_RESULTS);
    if (parsed.length) {
      warmCache(parsed); // fire-and-forget enrichment
      return {
        results: parsed.map((r) => ({ ...r, matched: true })),
        degraded: false,
        source: "live",
      };
    }
    // Live reachable but no full-name match (e.g. a partial) -> cache prefix search.
    const results = await searchCache(q);
    return { results, degraded: false, source: results.length ? "cache" : "none" };
  } catch (_) {
    // Live unreachable -> cache.
    try {
      const results = await searchCache(q);
      return { results, degraded: true, source: results.length ? "cache" : "none" };
    } catch (_) {
      return { results: [], degraded: true, source: "none" };
    }
  }
}

// NDC -> exact drug. One call: ndcstatus.json returns the concept's rxcui and
// conceptName (which carries the manufactured strength AND form). Returns null if the
// NDC doesn't resolve. NOTE: this identifies the PRODUCT (drug/strength/form) — it does
// NOT tell you the patient's dose (someone may take half a tablet), so callers must not
// treat the strength as the dose. Public reference data — no PHI.
async function lookupNdc(ndc) {
  const clean = String(ndc || "").replace(/\D/g, "");
  if (clean.length < 8 || clean.length > 12) return null; // NDCs are 10-11 digits
  try {
    const json = await fetchJson(
      `${RXNAV_BASE}/ndcstatus.json?ndc=${encodeURIComponent(clean)}`,
      LIVE_TIMEOUT_MS
    );
    const st = json?.ndcStatus;
    if (!st || !st.rxcui) return null;
    return {
      ndc: clean,
      rxcui: String(st.rxcui),
      name: st.conceptName || null, // e.g. "linaclotide 0.145 MG Oral Capsule [Linzess]"
      active: st.status === "ACTIVE",
    };
  } catch (_) {
    return null;
  }
}

// Refresh the cached snapshot from RxNav displaynames. Additive + non-destructive:
// INSERT IGNORE keeps live-warmed rxcui rows intact and just adds new names. Logs the
// outcome so staleness is observable. Intended to run periodically (see CLI +
// MEDICATIONS_DESIGN.md §1); NOT self-scheduling.
async function refreshCache() {
  try {
    const json = await fetchJson(`${RXNAV_BASE}/displaynames.json`, REFRESH_TIMEOUT_MS);
    const terms = json?.displayTermsList?.term || [];
    if (!terms.length) throw new Error("displaynames returned no terms");

    const CHUNK = 1000;
    for (let i = 0; i < terms.length; i += CHUNK) {
      const rows = terms
        .slice(i, i + CHUNK)
        .filter((t) => typeof t === "string" && t.length && t.length <= 255)
        .map((t) => [t, t.toLowerCase(), null, null, "displaynames"]);
      if (rows.length) {
        await db.query(
          `INSERT IGNORE INTO rxnorm_drugs (name, search_name, rxcui, tty, source)
           VALUES ?`,
          [rows]
        );
      }
    }

    const [[{ cnt }]] = await db.query(`SELECT COUNT(*) AS cnt FROM rxnorm_drugs`);
    await db.query(
      `INSERT INTO rxnorm_refresh_log (name_count, status, message) VALUES (?, 'success', ?)`,
      [cnt, `fetched ${terms.length} terms`]
    );
    return { ok: true, terms: terms.length, cacheCount: cnt };
  } catch (err) {
    await db.query(
      `INSERT INTO rxnorm_refresh_log (name_count, status, message) VALUES (0, 'failed', ?)`,
      [String(err.message || err).slice(0, 500)]
    );
    throw err;
  }
}

// Staleness is observable, never enforced. Returns last refresh + age + a warning flag.
async function getCacheStatus() {
  const [[count]] = await db.query(`SELECT COUNT(*) AS cnt FROM rxnorm_drugs`);
  const [[last]] = await db.query(
    `SELECT refreshed_at, name_count, status
       FROM rxnorm_refresh_log
      WHERE status = 'success'
      ORDER BY refreshed_at DESC
      LIMIT 1`
  );
  let ageDays = null;
  if (last?.refreshed_at) {
    ageDays = Math.floor((Date.now() - new Date(last.refreshed_at).getTime()) / 86400000);
  }
  return {
    cacheCount: count.cnt,
    lastRefreshedAt: last?.refreshed_at || null,
    ageDays,
    stale: ageDays == null ? true : ageDays > STALE_AFTER_DAYS,
    staleAfterDays: STALE_AFTER_DAYS,
  };
}

module.exports = { searchDrugs, lookupNdc, refreshCache, getCacheStatus, MIN_QUERY_LEN };
