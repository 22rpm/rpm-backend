// controllers/callDoc.controller.js
//
// Part 4: patient call documentation. Documentation only — records that a call
// happened; sends nothing. staff_user_id and organization_id are always derived
// server-side (req.user.id / req.orgScope), never from the body. When the call
// carries time, the call endpoint writes to the time_entries ledger (category
// forced to 'patient_call') in the same transaction (see callDoc.service).
const callService = require("../services/callDoc.service");
const timeEntryService = require("../services/timeEntry.service");
const {
  validateStartedAt,
  validateDurationMinutes,
} = require("../services/careValidation");
const { CALL_OUTCOMES } = require("../config/callOutcomes");

const DIRECTIONS = ["outbound", "inbound"];

// Validates the shared call body (create + correct). duration_minutes is
// optional (a no-answer call has no billable time); reason/outcome are optional.
function validateCallBody(body) {
  const errors = [];
  const { started_at, direction, reason, outcome, note, duration_minutes } =
    body || {};

  const st = validateStartedAt(started_at);
  if (st.error) errors.push(st.error);

  if (typeof note !== "string" || note.trim() === "") {
    errors.push("note is required");
  }

  let dir = "outbound"; // default
  if (direction !== undefined && direction !== null && direction !== "") {
    if (!DIRECTIONS.includes(direction)) {
      errors.push("direction must be 'outbound' or 'inbound'");
    } else {
      dir = direction;
    }
  }

  let durationSeconds = null;
  if (
    duration_minutes !== undefined &&
    duration_minutes !== null &&
    duration_minutes !== ""
  ) {
    const d = validateDurationMinutes(duration_minutes);
    if (d.error) errors.push(d.error);
    else durationSeconds = d.seconds;
  }

  const reasonVal =
    typeof reason === "string" && reason.trim() !== "" ? reason.trim() : null;
  // outcome is a constrained set (or null); detail belongs in `note`.
  const outcomeVal =
    typeof outcome === "string" && outcome.trim() !== "" ? outcome.trim() : null;
  if (outcomeVal !== null && !CALL_OUTCOMES.includes(outcomeVal)) {
    errors.push("outcome must be one of: " + CALL_OUTCOMES.join(", "));
  }

  return {
    errors,
    startedDate: st.date,
    direction: dir,
    reason: reasonVal,
    outcome: outcomeVal,
    durationSeconds,
    note: typeof note === "string" ? note.trim() : note,
  };
}

async function withTimeEntry(call) {
  const timeEntry = call.time_entry_id
    ? await timeEntryService.getEntryById(call.time_entry_id)
    : null;
  return timeEntry;
}

// POST /api/care/patients/:patientId/calls
async function createCall(req, res) {
  try {
    const v = validateCallBody(req.body);
    if (v.errors.length) {
      return res
        .status(400)
        .json({ ok: false, message: "Validation failed", errors: v.errors });
    }

    const call = await callService.createCall({
      patientId: req.scopedPatientId,
      staffUserId: req.user.id, // server-side, never from body
      organizationId: req.orgScope, // server-side, never from body
      direction: v.direction,
      reason: v.reason,
      outcome: v.outcome,
      note: v.note,
      startedAt: v.startedDate,
      durationSeconds: v.durationSeconds,
    });

    return res
      .status(201)
      .json({ ok: true, call, time_entry: await withTimeEntry(call) });
  } catch (err) {
    console.error("createCall error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// GET /api/care/patients/:patientId/calls
async function listCalls(req, res) {
  try {
    const calls = await callService.listHeadCallsForPatient(
      req.scopedPatientId,
      req.orgScope
    );
    return res.status(200).json({ ok: true, calls });
  } catch (err) {
    console.error("listCalls error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// POST /api/care/patients/:patientId/calls/:id/correct
async function correctCall(req, res) {
  try {
    const originalId = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(originalId)) {
      return res.status(404).json({ ok: false, message: "Call not found" });
    }

    const original = await callService.getCallById(originalId);
    if (
      !original ||
      Number(original.patient_id) !== Number(req.scopedPatientId) ||
      Number(original.organization_id) !== Number(req.orgScope)
    ) {
      return res.status(404).json({ ok: false, message: "Call not found" });
    }

    const alreadySuperseded = await callService.findCallSupersededBy(originalId);
    if (alreadySuperseded) {
      return res.status(409).json({
        ok: false,
        message:
          "This call has already been corrected; correct the current version instead",
        current_id: alreadySuperseded.id,
      });
    }

    const v = validateCallBody(req.body);
    if (v.errors.length) {
      return res
        .status(400)
        .json({ ok: false, message: "Validation failed", errors: v.errors });
    }

    const call = await callService.correctCall({
      original,
      patientId: req.scopedPatientId,
      organizationId: req.orgScope,
      direction: v.direction,
      reason: v.reason,
      outcome: v.outcome,
      note: v.note,
      startedAt: v.startedDate,
      durationSeconds: v.durationSeconds,
    });

    return res.status(201).json({
      ok: true,
      call,
      supersedes: originalId,
      time_entry: await withTimeEntry(call),
    });
  } catch (err) {
    // UNIQUE(supersedes) race on the call (or its linked time entry).
    if (err && err.code === "ER_DUP_ENTRY") {
      return res
        .status(409)
        .json({ ok: false, message: "This call has already been corrected" });
    }
    console.error("correctCall error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

module.exports = { createCall, listCalls, correctCall };
