// services/timeEntry.service.js
//
// Data access for the append-only clinical-time ledger (`time_entries`).
// Capture layer only — no billing/CPT logic. duration_seconds is stored, never
// derived. Corrections are new rows pointing back via `supersedes`; the head of
// a chain is the row nothing else supersedes (LEFT JOIN, not NOT IN).
const db = require("../config/db");

// The constrained §3.8 set. Kept here so the controller validates against the
// same list the ENUM enforces.
const ACTIVITY_CATEGORIES = [
  "patient_call",
  "reading_review",
  "care_coordination",
  "provider_communication",
  "documentation",
  "device_assistance",
  "other",
];

// `executor` is the pool by default, or a transaction connection when a caller
// (e.g. call documentation) needs these inserts inside a transaction.
async function getEntryById(id, executor = db) {
  const [rows] = await executor.query(
    "SELECT * FROM time_entries WHERE id = ?",
    [id]
  );
  return rows[0] || null;
}

// Insert a completed manual entry. ended_at is computed once and stored.
async function createManualEntry(
  {
    patientId,
    staffUserId,
    organizationId,
    activityCategory,
    startedAt,
    durationSeconds,
    note,
  },
  executor = db
) {
  const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
  const [result] = await executor.query(
    `INSERT INTO time_entries
       (patient_id, staff_user_id, organization_id, activity_category,
        started_at, ended_at, duration_seconds, entry_method, status, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', 'complete', ?)`,
    [
      patientId,
      staffUserId,
      organizationId,
      activityCategory,
      startedAt,
      endedAt,
      durationSeconds,
      note,
    ]
  );
  return getEntryById(result.insertId, executor);
}

// Head-of-chain entries for a patient (org-scoped), newest first. The LEFT JOIN
// drops any row that another row supersedes, so only current versions show.
async function listHeadEntriesForPatient(patientId, organizationId) {
  const [rows] = await db.query(
    `SELECT t.*
       FROM time_entries t
       LEFT JOIN time_entries s ON s.supersedes = t.id
      WHERE t.patient_id = ?
        AND t.organization_id = ?
        AND s.id IS NULL
      ORDER BY t.started_at DESC, t.id DESC`,
    [patientId, organizationId]
  );
  return rows;
}

// The row (if any) that already supersedes `id` — used to reject correcting a
// non-head row before we hit the UNIQUE(supersedes) constraint.
async function findSupersededBy(id) {
  const [rows] = await db.query(
    "SELECT id FROM time_entries WHERE supersedes = ?",
    [id]
  );
  return rows[0] || null;
}

// Insert a superseding correction row.
async function createCorrection(
  {
    originalId,
    patientId,
    staffUserId,
    organizationId,
    activityCategory,
    startedAt,
    durationSeconds,
    note,
  },
  executor = db
) {
  const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
  const [result] = await executor.query(
    `INSERT INTO time_entries
       (patient_id, staff_user_id, organization_id, activity_category,
        started_at, ended_at, duration_seconds, entry_method, status, note, supersedes)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', 'complete', ?, ?)`,
    [
      patientId,
      staffUserId,
      organizationId,
      activityCategory,
      startedAt,
      endedAt,
      durationSeconds,
      note,
      originalId,
    ]
  );
  return getEntryById(result.insertId, executor);
}

module.exports = {
  ACTIVITY_CATEGORIES,
  getEntryById,
  createManualEntry,
  listHeadEntriesForPatient,
  findSupersededBy,
  createCorrection,
};
