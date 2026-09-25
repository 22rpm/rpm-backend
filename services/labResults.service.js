// services/labResults.service.js
//
// Data access for lab results (LAB_RESULTS_DESIGN.md). Append-only with a correction
// chain via `supersedes`, exactly like time_entries: a correction is a new row pointing
// back at the row it replaces; the head of a chain is the row nothing supersedes
// (LEFT JOIN, not NOT IN). Increment 1 writes source='manual' only; the `source` column
// lets API/file adapters slot in later with no schema change. No CPU/billing logic here.
const db = require("../config/db");

// Mirrors the abnormal_flag ENUM — the controller validates against the same list.
const ABNORMAL_FLAGS = [
  "normal",
  "low",
  "high",
  "critical_low",
  "critical_high",
  "abnormal",
];

async function getLabById(id, executor = db) {
  const [rows] = await executor.query("SELECT * FROM lab_results WHERE id = ?", [id]);
  return rows[0] || null;
}

// The column set shared by create + correct. `source` is forced 'manual' here (increment 1);
// api/file ingestion would set it explicitly. `enteredBy` is who keyed THIS version.
function insertColumns(fields) {
  return {
    patient_id: fields.patientId,
    organization_id: fields.organizationId,
    entered_by: fields.enteredBy ?? null,
    test_name: fields.testName,
    loinc_code: fields.loincCode ?? null,
    value_text: fields.valueText,
    value_num: fields.valueNum ?? null,
    unit: fields.unit ?? null,
    reference_range: fields.referenceRange ?? null,
    abnormal_flag: fields.abnormalFlag ?? null,
    collected_at: fields.collectedAt ?? null,
    resulted_at: fields.resultedAt ?? null,
    resulting_lab: fields.resultingLab ?? null,
    panel_ref: fields.panelRef ?? null,
  };
}

// Insert a manual lab result. source='manual', source_ref=null (multiple manual rows are
// fine — the source_ref UNIQUE only dedupes api/file imports).
async function createManualResult(fields, executor = db) {
  const [result] = await executor.query(
    `INSERT INTO lab_results
       (patient_id, organization_id, entered_by, test_name, loinc_code, value_text,
        value_num, unit, reference_range, abnormal_flag, collected_at, resulted_at,
        resulting_lab, panel_ref, source, source_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL)`,
    columnValues(insertColumns(fields))
  );
  return getLabById(result.insertId, executor);
}

// Insert a superseding correction row (source='manual'). entered_by = the corrector (who
// keyed this version); the superseded original keeps its own entered_by in the chain.
async function createCorrection(fields, executor = db) {
  const [result] = await executor.query(
    `INSERT INTO lab_results
       (patient_id, organization_id, entered_by, test_name, loinc_code, value_text,
        value_num, unit, reference_range, abnormal_flag, collected_at, resulted_at,
        resulting_lab, panel_ref, source, source_ref, supersedes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, ?)`,
    [...columnValues(insertColumns(fields)), fields.originalId]
  );
  return getLabById(result.insertId, executor);
}

// Keep the INSERT param order in one place so create + correct can't drift.
function columnValues(c) {
  return [
    c.patient_id,
    c.organization_id,
    c.entered_by,
    c.test_name,
    c.loinc_code,
    c.value_text,
    c.value_num,
    c.unit,
    c.reference_range,
    c.abnormal_flag,
    c.collected_at,
    c.resulted_at,
    c.resulting_lab,
    c.panel_ref,
  ];
}

// Head-of-chain results for a patient (org-scoped), newest collection first. The LEFT JOIN
// drops any row another row supersedes, so a corrected result replaces its original — the
// two never both show as current. Carries the enterer's name for display.
async function listHeadResultsForPatient(patientId, organizationId) {
  const [rows] = await db.query(
    `SELECT r.*, u.name AS entered_by_name
       FROM lab_results r
       LEFT JOIN lab_results s ON s.supersedes = r.id
       LEFT JOIN users u ON u.id = r.entered_by
      WHERE r.patient_id = ?
        AND r.organization_id = ?
        AND s.id IS NULL
      ORDER BY r.collected_at DESC, r.id DESC`,
    [patientId, organizationId]
  );
  return rows;
}

// The row (if any) that already supersedes `id` — reject correcting a non-head row before
// hitting the UNIQUE(supersedes) constraint.
async function findSupersededBy(id) {
  const [rows] = await db.query(
    "SELECT id FROM lab_results WHERE supersedes = ?",
    [id]
  );
  return rows[0] || null;
}

module.exports = {
  ABNORMAL_FLAGS,
  getLabById,
  createManualResult,
  createCorrection,
  listHeadResultsForPatient,
  findSupersededBy,
};
