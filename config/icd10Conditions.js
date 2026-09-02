// config/icd10Conditions.js
//
// The CURATED ICD-10 shortlist for patient conditions — the diagnoses our RPM
// patients actually carry, not the full code set. One file, shared shape across
// both repos (served to the dashboard via enrollment-options), so the pickable
// codes live in exactly one place.
//
// SCOPE (2026-09): codes are recorded ON THE PATIENT only — they are NOT yet
// carried onto the RPM note or the biller report. The note still shows its
// hardcoded "no ICD-10 on this note" manual-check string (rpmNote.service). When
// the billers confirm the wiring, reading `patient_conditions.icd10_code` into
// the note is a small change; this list does not need to move.
//
// Free-text conditions remain allowed (icd10_code = null) so nothing already
// entered breaks and a diagnosis outside this list can still be recorded uncoded
// rather than guessed at.

const ICD10_CONDITIONS = [
  { code: "I10", label: "Essential (primary) hypertension", category: "Hypertension" },

  { code: "E11.9", label: "Type 2 diabetes mellitus, without complications", category: "Diabetes" },
  { code: "E11.65", label: "Type 2 diabetes mellitus with hyperglycemia", category: "Diabetes" },
  { code: "E11.22", label: "Type 2 diabetes mellitus with diabetic chronic kidney disease", category: "Diabetes" },
  { code: "E10.9", label: "Type 1 diabetes mellitus, without complications", category: "Diabetes" },

  { code: "N18.1", label: "Chronic kidney disease, stage 1", category: "Chronic kidney disease" },
  { code: "N18.2", label: "Chronic kidney disease, stage 2 (mild)", category: "Chronic kidney disease" },
  { code: "N18.30", label: "Chronic kidney disease, stage 3 unspecified", category: "Chronic kidney disease" },
  { code: "N18.31", label: "Chronic kidney disease, stage 3a", category: "Chronic kidney disease" },
  { code: "N18.32", label: "Chronic kidney disease, stage 3b", category: "Chronic kidney disease" },
  { code: "N18.4", label: "Chronic kidney disease, stage 4 (severe)", category: "Chronic kidney disease" },
  { code: "N18.5", label: "Chronic kidney disease, stage 5", category: "Chronic kidney disease" },
  { code: "N18.6", label: "End-stage renal disease", category: "Chronic kidney disease" },
  { code: "N18.9", label: "Chronic kidney disease, unspecified", category: "Chronic kidney disease" },

  { code: "I50.9", label: "Heart failure, unspecified", category: "Heart failure" },
  { code: "I50.22", label: "Chronic systolic (congestive) heart failure", category: "Heart failure" },
  { code: "I50.32", label: "Chronic diastolic (congestive) heart failure", category: "Heart failure" },
  { code: "I50.42", label: "Chronic combined systolic and diastolic (congestive) heart failure", category: "Heart failure" },

  { code: "J44.9", label: "Chronic obstructive pulmonary disease, unspecified", category: "COPD" },
  { code: "J44.1", label: "COPD with (acute) exacerbation", category: "COPD" },
  { code: "J44.0", label: "COPD with acute lower respiratory infection", category: "COPD" },

  { code: "I48.91", label: "Unspecified atrial fibrillation", category: "Other common" },
  { code: "E78.5", label: "Hyperlipidemia, unspecified", category: "Other common" },
  { code: "I25.10", label: "Atherosclerotic heart disease of native coronary artery without angina pectoris", category: "Other common" },
  { code: "E66.9", label: "Obesity, unspecified", category: "Other common" },
];

// Fast membership check for validation: a stored icd10_code must be either null
// (free text) or one of these curated codes — an arbitrary code is rejected so
// the coded set stays clean and the picker stays authoritative.
const VALID_ICD10_CODES = new Set(ICD10_CONDITIONS.map((c) => c.code));

// One-time backfill map for the migration: the exact free-text names already in
// patient_conditions -> the code they map to CLEANLY. Anything not listed here
// stays uncoded (icd10_code = null) rather than being guessed at. Names are the
// verbatim values found in the data on 2026-09-01.
const BACKFILL_NAME_TO_CODE = {
  "Hypertension": "I10",
  "Type 2 diabetes": "E11.9",
  "Type 2 diabetes mellitus": "E11.9",
  "Chronic kidney disease, stage 3": "N18.30",
  "Chronic obstructive pulmonary disease with acute lower respiratory infection": "J44.0",
};

// Conditions arrive as either plain strings (legacy/free text) or
// { name, icd10_code } objects (the curated picker). Normalize to objects; an
// icd10_code not in the curated set drops to null rather than being stored, so
// the coded data stays clean and the picker stays authoritative. Shared by the
// enroll and edit controllers so both accept the same shapes identically.
function normalizeConditions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      if (typeof c === "string") return { name: c.trim(), icd10_code: null };
      if (c && typeof c === "object" && typeof c.name === "string")
        return {
          name: c.name.trim(),
          icd10_code:
            c.icd10_code && VALID_ICD10_CODES.has(c.icd10_code) ? c.icd10_code : null,
        };
      return null;
    })
    .filter((c) => c && c.name);
}

// Returns an error string, or null if valid. Accepts strings or {name,...}.
function validateConditions(raw) {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return "conditions must be an array";
  for (const c of raw) {
    if (typeof c === "string") {
      if (!c.trim()) return "conditions must be non-empty";
    } else if (c && typeof c === "object") {
      if (typeof c.name !== "string" || !c.name.trim())
        return "each condition needs a non-empty name";
    } else {
      return "conditions must be strings or {name, icd10_code} objects";
    }
  }
  return null;
}

module.exports = {
  ICD10_CONDITIONS,
  VALID_ICD10_CODES,
  BACKFILL_NAME_TO_CODE,
  normalizeConditions,
  validateConditions,
};
