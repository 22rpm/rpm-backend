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

// Supervision link, resolved and STORED at write time (not inferred at read
// time). Returns null when the actor is themselves a clinician — they performed
// the work personally, there is no supervisor — and null when the patient has no
// single assigned clinician, because inventing one would manufacture a
// supervision claim nobody made. A null here means "not recorded", which the
// note surfaces rather than papers over.
async function resolveSupervisingProvider(
  { patientId, staffUserId },
  executor = db
) {
  const [[actor]] = await executor.query(
    "SELECT role_type FROM role WHERE user_id = ? LIMIT 1",
    [staffUserId]
  );
  if (actor && actor.role_type === "clinician") return null;

  const [rows] = await executor.query(
    "SELECT doctor_id FROM patient_doctor_assignments WHERE patient_id = ?",
    [patientId]
  );
  // Exactly one assigned clinician, or we do not guess.
  return rows.length === 1 ? rows[0].doctor_id : null;
}

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
  const supervisingProviderId = await resolveSupervisingProvider(
    { patientId, staffUserId },
    executor
  );
  const [result] = await executor.query(
    `INSERT INTO time_entries
       (patient_id, staff_user_id, organization_id, activity_category,
        started_at, ended_at, duration_seconds, entry_method, status, note,
        supervising_provider_id)
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
      supervisingProviderId,
    ]
  );
  return getEntryById(result.insertId, executor);
}

// Head-of-chain entries for a patient (org-scoped), newest first. The LEFT JOIN
// drops any row that another row supersedes, so only current versions show.
async function listHeadEntriesForPatient(patientId, organizationId) {
  const [rows] = await db.query(
    // staff_user_id on the head row is the ORIGINAL actor — corrections carry it
    // forward (see care.controller.correctTimeEntry), so this attributes the work to who
    // did it, not who corrected it. LEFT JOIN so a deleted user never hides an entry.
    `SELECT t.*, u.name AS staff_name
       FROM time_entries t
       LEFT JOIN time_entries s ON s.supersedes = t.id
       LEFT JOIN users u ON u.id = t.staff_user_id
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
//
// The supervision link is CARRIED FORWARD from the row being corrected, never
// re-resolved. Re-resolving would stamp the correction with today's assignment,
// silently rewriting who supervised work performed months ago — the same class
// of drift this column was added to eliminate. `staff_user_id` is preserved by
// the caller for the same reason.
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
  const original = await getEntryById(originalId, executor);
  const carriedSupervisor = original ? original.supervising_provider_id : null;
  const [result] = await executor.query(
    `INSERT INTO time_entries
       (patient_id, staff_user_id, organization_id, activity_category,
        started_at, ended_at, duration_seconds, entry_method, status, note,
        supersedes, supervising_provider_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', 'complete', ?, ?, ?)`,
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
      carriedSupervisor,
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
