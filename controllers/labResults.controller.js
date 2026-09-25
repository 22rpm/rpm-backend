// controllers/labResults.controller.js
//
// Lab results (LAB_RESULTS_DESIGN.md, increment 1) — manual entry + correction.
// patient_id, organization_id, entered_by, and source are ALWAYS derived server-side
// (req.scopedPatientId / req.orgScope / req.user.id / forced 'manual'), never from the
// body. Patient-linked access is org-scoped by the route middleware (resolveOrgScope +
// scopePatientParam). Corrections use the supersedes chain (only the head is correctable).
const crypto = require("crypto");
const labService = require("../services/labResults.service");

const MAX_IMPORT_ROWS = 500;

// Deterministic per-row shape used to build the batch dedup hash. Fixed key order, dates
// as ISO, everything else normalized/nulled — so the same parsed file always serializes
// identically regardless of raw formatting.
function canonicalRow(f) {
  return {
    test_name: f.testName,
    value_text: f.valueText,
    value_num: f.valueNum ?? null,
    unit: f.unit ?? null,
    reference_range: f.referenceRange ?? null,
    abnormal_flag: f.abnormalFlag ?? null,
    collected_at: f.collectedAt ? f.collectedAt.toISOString() : null,
    resulted_at: f.resultedAt ? f.resultedAt.toISOString() : null,
    resulting_lab: f.resultingLab ?? null,
    loinc_code: f.loincCode ?? null,
    panel_ref: f.panelRef ?? null,
  };
}

// Optional string -> trimmed value or null (empty/whitespace -> null).
function optStr(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

// Validate the shared body (create + correct). Returns parsed fields + errors.
function validateLabBody(body) {
  const errors = [];
  const b = body || {};

  const testName = optStr(b.test_name);
  if (!testName) errors.push("test_name is required");

  const valueText = optStr(b.value_text);
  if (!valueText) errors.push("value_text is required");

  let abnormalFlag = null;
  if (b.abnormal_flag !== undefined && b.abnormal_flag !== null && b.abnormal_flag !== "") {
    if (!labService.ABNORMAL_FLAGS.includes(b.abnormal_flag)) {
      errors.push("abnormal_flag must be one of: " + labService.ABNORMAL_FLAGS.join(", "));
    } else {
      abnormalFlag = b.abnormal_flag;
    }
  }

  let valueNum = null;
  if (b.value_num !== undefined && b.value_num !== null && b.value_num !== "") {
    const n = Number(b.value_num);
    if (!Number.isFinite(n)) errors.push("value_num must be a number");
    else valueNum = n;
  }

  const parseDate = (v, label) => {
    if (v === undefined || v === null || v === "") return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      errors.push(`${label} must be a valid date`);
      return null;
    }
    return d;
  };
  const collectedAt = parseDate(b.collected_at, "collected_at");
  const resultedAt = parseDate(b.resulted_at, "resulted_at");

  return {
    errors,
    fields: {
      testName,
      valueText,
      abnormalFlag,
      valueNum,
      collectedAt,
      resultedAt,
      unit: optStr(b.unit),
      referenceRange: optStr(b.reference_range),
      resultingLab: optStr(b.resulting_lab),
      loincCode: optStr(b.loinc_code),
      panelRef: optStr(b.panel_ref),
    },
  };
}

// POST /api/care/patients/:patientId/labs
async function createLab(req, res) {
  try {
    const { errors, fields } = validateLabBody(req.body);
    if (errors.length) {
      return res.status(400).json({ ok: false, message: "Validation failed", errors });
    }
    const result = await labService.createManualResult({
      patientId: req.scopedPatientId, // verified in-org by scopePatientParam
      organizationId: req.orgScope, // server-side
      enteredBy: req.user.id, // server-side
      ...fields,
    });
    return res.status(201).json({ ok: true, result });
  } catch (err) {
    console.error("createLab error:", err.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// GET /api/care/patients/:patientId/labs
async function listLabs(req, res) {
  try {
    const results = await labService.listHeadResultsForPatient(
      req.scopedPatientId,
      req.orgScope
    );
    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error("listLabs error:", err.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// POST /api/care/patients/:patientId/labs/:id/correct
async function correctLab(req, res) {
  try {
    const originalId = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(originalId)) {
      return res.status(404).json({ ok: false, message: "Lab result not found" });
    }

    // Target must exist and belong to this patient AND org, else 404 (don't confirm
    // existence outside the caller's scope).
    const original = await labService.getLabById(originalId);
    if (
      !original ||
      Number(original.patient_id) !== Number(req.scopedPatientId) ||
      Number(original.organization_id) !== Number(req.orgScope)
    ) {
      return res.status(404).json({ ok: false, message: "Lab result not found" });
    }

    // Only the head of a chain can be corrected.
    const alreadySuperseded = await labService.findSupersededBy(originalId);
    if (alreadySuperseded) {
      return res.status(409).json({
        ok: false,
        message:
          "This result has already been corrected; correct the current version instead",
        current_id: alreadySuperseded.id,
      });
    }

    const { errors, fields } = validateLabBody(req.body);
    if (errors.length) {
      return res.status(400).json({ ok: false, message: "Validation failed", errors });
    }

    const correction = await labService.createCorrection({
      originalId,
      patientId: req.scopedPatientId,
      organizationId: req.orgScope,
      enteredBy: req.user.id, // who keyed the correction
      ...fields,
    });
    return res.status(201).json({ ok: true, result: correction, supersedes: originalId });
  } catch (err) {
    // UNIQUE(supersedes) race: another correction landed first.
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        ok: false,
        message: "This result has already been corrected",
      });
    }
    console.error("correctLab error:", err.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// POST /api/care/patients/:patientId/labs/import
// CSV import (source='file'). Body: { rows: [ {test_name, value_text, unit, ...}, ... ] } —
// the client's parsed rows in file order (client also previews them; the server re-validates).
// The dedup key is DERIVED SERVER-SIDE from the normalized batch (never a client hash):
// source_ref = "<sha256(canonical batch)>:<rowIndex>", so re-importing the same file
// dup-skips every row via UNIQUE(source, source_ref). Per-row outcome is returned.
async function importLabs(req, res) {
  try {
    const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : null;
    if (!rows || rows.length === 0) {
      return res.status(400).json({ ok: false, message: "No rows to import" });
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      return res
        .status(400)
        .json({ ok: false, message: `Too many rows (max ${MAX_IMPORT_ROWS})` });
    }

    // Validate + normalize every row up front; the normalized fields feed BOTH the dedup
    // hash and the insert, so the key reflects exactly what would be stored.
    const normalized = rows.map((raw) => validateLabBody(raw));

    // Server-derived dedup key over the whole batch, in submitted (file) order.
    const canonical = JSON.stringify(normalized.map(({ fields }) => canonicalRow(fields)));
    const batchHash = crypto.createHash("sha256").update(canonical).digest("hex");

    const results = [];
    let written = 0;
    let duplicate = 0;
    let failed = 0;
    for (let i = 0; i < normalized.length; i++) {
      const { errors, fields } = normalized[i];
      if (errors.length) {
        failed++;
        results.push({ row: i, outcome: "error", errors });
        continue;
      }
      try {
        const created = await labService.createResult({
          patientId: req.scopedPatientId,
          organizationId: req.orgScope,
          enteredBy: req.user.id,
          source: "file",
          sourceRef: `${batchHash}:${i}`,
          ...fields,
        });
        written++;
        results.push({ row: i, outcome: "written", id: created.id });
      } catch (err) {
        if (err && err.code === "ER_DUP_ENTRY") {
          duplicate++;
          results.push({ row: i, outcome: "duplicate" });
        } else {
          failed++;
          results.push({ row: i, outcome: "error", errors: ["Server error"] });
          console.error("importLabs row error:", err.message);
        }
      }
    }

    return res.status(200).json({
      ok: true,
      summary: { written, duplicate, failed, total: normalized.length },
      results,
    });
  } catch (err) {
    console.error("importLabs error:", err.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

module.exports = { createLab, listLabs, correctLab, importLabs };
