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

// Strip a dotted/loose code to the table's dot-less storage form: "L60.3" -> "L603".
function toDotless(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Validate the ICD-10 codes on a conditions array against the FULL set — BILLABLE ONLY.
// This is the "flip": storage is gated by the real code set, not the curated shortlist.
// Returns an error STRING (naming the offending code) or null. Codes are matched dot-less;
// a code that isn't in the table, or is a non-billable header, is rejected at ENTRY — a
// header on a claim is a rejection, so we don't let one be stored. Conditions with no code
// (free text) pass untouched. Requires icd10cm_codes to be seeded (deploy prerequisite).
async function validateConditionCodes(conditions) {
  if (!Array.isArray(conditions)) return null;
  // Collect provided codes with their display form for a clear error message.
  const provided = [];
  for (const c of conditions) {
    if (c && typeof c === "object" && c.icd10_code != null && String(c.icd10_code).trim() !== "") {
      provided.push({ display: String(c.icd10_code).trim(), key: toDotless(c.icd10_code), name: c.name });
    }
  }
  if (provided.length === 0) return null;

  const keys = [...new Set(provided.map((p) => p.key))];
  const [rows] = await db.query(
    `SELECT code, billable FROM icd10cm_codes WHERE code IN (?)`,
    [keys]
  );
  const found = new Map(rows.map((r) => [r.code, !!r.billable]));

  for (const p of provided) {
    if (!found.has(p.key)) {
      return `Unrecognized ICD-10 code "${p.display}"${p.name ? ` for "${p.name}"` : ""} — not a valid ICD-10-CM code.`;
    }
    if (!found.get(p.key)) {
      return `"${p.display}" is a non-billable ICD-10 category — pick a specific (billable) code under it.`;
    }
  }
  return null;
}

module.exports = { searchConditions, toDotted, toDotless, looksLikeCode, validateConditionCodes, MIN_QUERY_LEN };
