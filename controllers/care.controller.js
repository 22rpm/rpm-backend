// controllers/care.controller.js
//
// Part 2: manual time entry. Capture layer only. staff_user_id and
// organization_id are ALWAYS derived server-side (req.user.id / req.orgScope),
// never read from the request body. All patient-linked access is org-scoped by
// the route middleware (resolveOrgScope + scopePatientParam).
const timeEntryService = require("../services/timeEntry.service");
const {
  validateStartedAt,
  validateDurationMinutes,
} = require("../services/careValidation");

// Validates the shared entry body (create + correct). Returns parsed values.
function validateEntryBody(body) {
  const errors = [];
  const { activity_category, started_at, duration_minutes, note } = body || {};

  if (!timeEntryService.ACTIVITY_CATEGORIES.includes(activity_category)) {
    errors.push(
      "activity_category must be one of: " +
        timeEntryService.ACTIVITY_CATEGORIES.join(", ")
    );
  }

  const dur = validateDurationMinutes(duration_minutes);
  if (dur.error) errors.push(dur.error);

  if (typeof note !== "string" || note.trim() === "") {
    errors.push("note is required for manual entries");
  }

  const st = validateStartedAt(started_at);
  if (st.error) errors.push(st.error);

  return { errors, minutes: dur.minutes, startedDate: st.date };
}

// POST /api/care/patients/:patientId/time-entries
async function createTimeEntry(req, res) {
  try {
    const { errors, minutes, startedDate } = validateEntryBody(req.body);
    if (errors.length) {
      return res
        .status(400)
        .json({ ok: false, message: "Validation failed", errors });
    }

    const entry = await timeEntryService.createManualEntry({
      patientId: req.scopedPatientId, // verified in-org by scopePatientParam
      staffUserId: req.user.id, // server-side, never from body
      organizationId: req.orgScope, // server-side, never from body
      activityCategory: req.body.activity_category,
      startedAt: startedDate,
      durationSeconds: minutes * 60,
      note: req.body.note.trim(),
    });

    return res.status(201).json({ ok: true, entry });
  } catch (err) {
    console.error("createTimeEntry error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// GET /api/care/patients/:patientId/time-entries
async function listTimeEntries(req, res) {
  try {
    const entries = await timeEntryService.listHeadEntriesForPatient(
      req.scopedPatientId,
      req.orgScope
    );
    return res.status(200).json({ ok: true, entries });
  } catch (err) {
    console.error("listTimeEntries error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// POST /api/care/patients/:patientId/time-entries/:id/correct
async function correctTimeEntry(req, res) {
  try {
    const originalId = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(originalId)) {
      return res
        .status(404)
        .json({ ok: false, message: "Time entry not found" });
    }

    // The target must exist and belong to this patient AND org. Otherwise 404
    // (don't confirm existence of entries outside the caller's scope).
    const original = await timeEntryService.getEntryById(originalId);
    if (
      !original ||
      Number(original.patient_id) !== Number(req.scopedPatientId) ||
      Number(original.organization_id) !== Number(req.orgScope)
    ) {
      return res
        .status(404)
        .json({ ok: false, message: "Time entry not found" });
    }

    // Only the head of a correction chain can be corrected.
    const alreadySuperseded = await timeEntryService.findSupersededBy(originalId);
    if (alreadySuperseded) {
      return res.status(409).json({
        ok: false,
        message:
          "This entry has already been corrected; correct the current version instead",
        current_id: alreadySuperseded.id,
      });
    }

    const { errors, minutes, startedDate } = validateEntryBody(req.body);
    if (errors.length) {
      return res
        .status(400)
        .json({ ok: false, message: "Validation failed", errors });
    }

    const correction = await timeEntryService.createCorrection({
      originalId,
      patientId: req.scopedPatientId,
      // Preserve the original staff attribution: the clinical time belongs to
      // whoever performed the work, not whoever corrected the record. (The
      // corrector's identity is req.user.id but there is no corrected_by column
      // to store it — see report / follow-up.)
      staffUserId: original.staff_user_id,
      organizationId: req.orgScope,
      activityCategory: req.body.activity_category,
      startedAt: startedDate,
      durationSeconds: minutes * 60,
      note: req.body.note.trim(),
    });

    return res
      .status(201)
      .json({ ok: true, entry: correction, supersedes: originalId });
  } catch (err) {
    // UNIQUE(supersedes) race: another correction landed first.
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        ok: false,
        message: "This entry has already been corrected",
      });
    }
    console.error("correctTimeEntry error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

module.exports = { createTimeEntry, listTimeEntries, correctTimeEntry };
