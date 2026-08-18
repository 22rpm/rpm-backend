// controllers/clinicalNote.controller.js
//
// Part 5: clinical notes. staff_user_id and organization_id are always derived
// server-side (req.user.id / req.orgScope), never from the body. Append-only:
// corrections write a superseding row and preserve the original author.
const noteService = require("../services/clinicalNote.service");

// note_type is a short structured tag; the column is VARCHAR(50).
const MAX_NOTE_TYPE_LEN = 50;

// Validates the shared note body (create + correct).
function validateNoteBody(reqBody) {
  const errors = [];
  const { body, note_type } = reqBody || {};

  if (typeof body !== "string" || body.trim() === "") {
    errors.push("body is required");
  }

  let noteType = null;
  if (note_type !== undefined && note_type !== null && note_type !== "") {
    if (typeof note_type !== "string") {
      errors.push("note_type must be a string");
    } else if (note_type.trim().length > MAX_NOTE_TYPE_LEN) {
      errors.push(`note_type must be at most ${MAX_NOTE_TYPE_LEN} characters`);
    } else {
      noteType = note_type.trim();
    }
  }

  return {
    errors,
    body: typeof body === "string" ? body.trim() : body,
    noteType,
  };
}

// POST /api/care/patients/:patientId/notes
async function createNote(req, res) {
  try {
    const v = validateNoteBody(req.body);
    if (v.errors.length) {
      return res
        .status(400)
        .json({ ok: false, message: "Validation failed", errors: v.errors });
    }

    const note = await noteService.createNote({
      patientId: req.scopedPatientId,
      staffUserId: req.user.id, // server-side, never from body
      organizationId: req.orgScope, // server-side, never from body
      noteType: v.noteType,
      body: v.body,
    });

    return res.status(201).json({ ok: true, note });
  } catch (err) {
    console.error("createNote error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// GET /api/care/patients/:patientId/notes
async function listNotes(req, res) {
  try {
    const notes = await noteService.listHeadNotesForPatient(
      req.scopedPatientId,
      req.orgScope
    );
    return res.status(200).json({ ok: true, notes });
  } catch (err) {
    console.error("listNotes error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// POST /api/care/patients/:patientId/notes/:id/correct
async function correctNote(req, res) {
  try {
    const originalId = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(originalId)) {
      return res.status(404).json({ ok: false, message: "Note not found" });
    }

    const original = await noteService.getNoteById(originalId);
    if (
      !original ||
      Number(original.patient_id) !== Number(req.scopedPatientId) ||
      Number(original.organization_id) !== Number(req.orgScope)
    ) {
      return res.status(404).json({ ok: false, message: "Note not found" });
    }

    const alreadySuperseded = await noteService.findNoteSupersededBy(originalId);
    if (alreadySuperseded) {
      return res.status(409).json({
        ok: false,
        message:
          "This note has already been corrected; correct the current version instead",
        current_id: alreadySuperseded.id,
      });
    }

    const v = validateNoteBody(req.body);
    if (v.errors.length) {
      return res
        .status(400)
        .json({ ok: false, message: "Validation failed", errors: v.errors });
    }

    const note = await noteService.createCorrection({
      originalId,
      patientId: req.scopedPatientId,
      staffUserId: original.staff_user_id, // preserve original author
      organizationId: req.orgScope,
      noteType: v.noteType,
      body: v.body,
    });

    return res.status(201).json({ ok: true, note, supersedes: originalId });
  } catch (err) {
    // UNIQUE(supersedes) race: another correction landed first.
    if (err && err.code === "ER_DUP_ENTRY") {
      return res
        .status(409)
        .json({ ok: false, message: "This note has already been corrected" });
    }
    console.error("correctNote error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

module.exports = { createNote, listNotes, correctNote };
