// services/icd10.service.js
//
// ICD-10-CM condition search over the local `icd10cm_codes` table (reference data, NO
// PHI). Local-first by design — no runtime dependency on an external API for a
// billing-adjacent workflow (see CONDITIONS_PICKER_DESIGN.md §"API vs local").
//
// Two entry patterns, because clinicians here read codes off the EHR screen more than
// they search by name:
//   - CODE paste (e.g. "L60.3"): the dominant path. We strip the dot, prefix-match on
//     `code`, and return the code plus its billable children so an exact paste resolves
//     in one step. Headers (billable=0) are returned too, flagged, so a paste of a bare
//     category ("E11") can be answered at entry instead of failing at claim submission.
//   - NAME search (e.g. "nail dystrophy"): substring over the description, BILLABLE ONLY
//     (you can't store a header as a diagnosis).
//
// Codes are stored dot-less in the table but ALWAYS returned dotted for display/storage
// (ICD-10-CM puts the dot after the 3rd character: "L603" -> "L60.3", "I10" -> "I10").

const db = require("../config/db");

const MIN_QUERY_LEN = 2;
const MAX_RESULTS = 20;

// "Looks like a code" = a letter then a digit (optionally with a dot/space), e.g. "L60",
// "e11.2". A name query ("diabetes") never matches this, so the two paths don't collide.
function looksLikeCode(q) {
  return /^[A-Za-z][0-9]/.test(q.trim());
}

// Dot-less storage form -> dotted display form.
function toDotted(code) {
  return code.length > 3 ? `${code.slice(0, 3)}.${code.slice(3)}` : code;
}

function row(r) {
  return {
    code: toDotted(r.code), // dotted, for display + storage
    code_raw: r.code, // dot-less, as stored in icd10cm_codes
    billable: !!r.billable,
    label: r.long_desc,
  };
}

async function searchConditions(query) {
  const q = (query || "").trim();
  if (q.length < MIN_QUERY_LEN) return { results: [], query_kind: null };

  if (looksLikeCode(q)) {
    // Strip everything but alphanumerics ("L60.3" / "l60 3" -> "L603"), prefix match.
    const codeKey = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!codeKey) return { results: [], query_kind: "code" };
    const [rows] = await db.query(
      `SELECT code, billable, long_desc
         FROM icd10cm_codes
        WHERE code LIKE ?
        ORDER BY billable DESC, code ASC
        LIMIT ?`,
      [`${codeKey}%`, MAX_RESULTS]
    );
    return { results: rows.map(row), query_kind: "code" };
  }

  // Name search — billable only (a header can't be a stored diagnosis).
  const [rows] = await db.query(
    `SELECT code, billable, long_desc
       FROM icd10cm_codes
      WHERE billable = 1 AND search_desc LIKE ?
      ORDER BY CHAR_LENGTH(long_desc) ASC, code ASC
      LIMIT ?`,
    [`%${q.toLowerCase()}%`, MAX_RESULTS]
  );
  return { results: rows.map(row), query_kind: "name" };
}

module.exports = { searchConditions, toDotted, looksLikeCode, MIN_QUERY_LEN };
