// services/clinicalNote.service.js
//
// Clinical notes (Part 5). Structured, timestamped notes tied to a staff member
// and a patient. Append-only: an edit writes a new row referencing the original
// via `supersedes`. Notes carry no time — clinical time is captured separately
// via manual entry / timer — so there is no ledger link here.
const db = require("../config/db");

async function getNoteById(id) {
  const [rows] = await db.query("SELECT * FROM clinical_notes WHERE id = ?", [
    id,
  ]);
  return rows[0] || null;
}

// The row (if any) that already supersedes `id` — used to reject correcting a
// non-head row before we hit the UNIQUE(supersedes) constraint.
async function findNoteSupersededBy(id) {
  const [rows] = await db.query(
    "SELECT id FROM clinical_notes WHERE supersedes = ?",
    [id]
  );
  return rows[0] || null;
}

// Head-of-chain notes for a patient (org-scoped), newest first. Notes have no
// started_at, so order by created_at.
async function listHeadNotesForPatient(patientId, organizationId) {
  const [rows] = await db.query(
    `SELECT n.*
       FROM clinical_notes n
       LEFT JOIN clinical_notes s ON s.supersedes = n.id
      WHERE n.patient_id = ?
        AND n.organization_id = ?
        AND s.id IS NULL
      ORDER BY n.created_at DESC, n.id DESC`,
    [patientId, organizationId]
  );
  return rows;
}

async function createNote({
  patientId,
  staffUserId,
  organizationId,
  noteType,
  body,
}) {
  const [result] = await db.query(
    `INSERT INTO clinical_notes
       (patient_id, staff_user_id, organization_id, note_type, body)
     VALUES (?, ?, ?, ?, ?)`,
    [patientId, staffUserId, organizationId, noteType, body]
  );
  return getNoteById(result.insertId);
}

async function createCorrection({
  originalId,
  patientId,
  staffUserId,
  organizationId,
  noteType,
  body,
}) {
  const [result] = await db.query(
    `INSERT INTO clinical_notes
       (patient_id, staff_user_id, organization_id, note_type, body, supersedes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [patientId, staffUserId, organizationId, noteType, body, originalId]
  );
  return getNoteById(result.insertId);
}

module.exports = {
  getNoteById,
  findNoteSupersededBy,
  listHeadNotesForPatient,
  createNote,
  createCorrection,
};
