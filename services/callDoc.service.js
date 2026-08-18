// services/callDoc.service.js
//
// Patient call documentation (Part 4). Append-only, same correction model as
// time_entries. A call may carry billable time: when it does, the time lives in
// the time_entries ledger (category 'patient_call') and the call links to it via
// time_entry_id. Creating/correcting a call that has time writes both rows in a
// single transaction so it can never half-fail.
const db = require("../config/db");
const timeEntryService = require("./timeEntry.service");

async function getCallById(id, executor = db) {
  const [rows] = await executor.query(
    "SELECT * FROM patient_calls WHERE id = ?",
    [id]
  );
  return rows[0] || null;
}

// The row (if any) that already supersedes `id` — used to reject correcting a
// non-head row before we hit the UNIQUE(supersedes) constraint.
async function findCallSupersededBy(id) {
  const [rows] = await db.query(
    "SELECT id FROM patient_calls WHERE supersedes = ?",
    [id]
  );
  return rows[0] || null;
}

// Head-of-chain calls for a patient (org-scoped), newest first, with the linked
// entry's duration when present.
async function listHeadCallsForPatient(patientId, organizationId) {
  const [rows] = await db.query(
    `SELECT c.*, te.duration_seconds AS time_duration_seconds
       FROM patient_calls c
       LEFT JOIN patient_calls s ON s.supersedes = c.id
       LEFT JOIN time_entries te ON te.id = c.time_entry_id
      WHERE c.patient_id = ?
        AND c.organization_id = ?
        AND s.id IS NULL
      ORDER BY c.started_at DESC, c.id DESC`,
    [patientId, organizationId]
  );
  return rows;
}

async function insertCall(
  executor,
  {
    patientId,
    staffUserId,
    organizationId,
    timeEntryId,
    direction,
    reason,
    outcome,
    note,
    startedAt,
    supersedes = null,
  }
) {
  const [result] = await executor.query(
    `INSERT INTO patient_calls
       (patient_id, staff_user_id, organization_id, time_entry_id,
        direction, reason, outcome, note, started_at, supersedes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      patientId,
      staffUserId,
      organizationId,
      timeEntryId,
      direction,
      reason,
      outcome,
      note,
      startedAt,
      supersedes,
    ]
  );
  return result.insertId;
}

// Create a new call, optionally with a linked time entry, atomically.
async function createCall({
  patientId,
  staffUserId,
  organizationId,
  direction,
  reason,
  outcome,
  note,
  startedAt,
  durationSeconds,
}) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let timeEntryId = null;
    if (durationSeconds != null) {
      const entry = await timeEntryService.createManualEntry(
        {
          patientId,
          staffUserId,
          organizationId,
          activityCategory: "patient_call", // forced; never from the body
          startedAt,
          durationSeconds,
          note,
        },
        conn
      );
      timeEntryId = entry.id;
    }

    const id = await insertCall(conn, {
      patientId,
      staffUserId,
      organizationId,
      timeEntryId,
      direction,
      reason,
      outcome,
      note,
      startedAt,
    });

    await conn.commit();
    return getCallById(id);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Correct a call (supersede its row). The linked time entry is superseded ONLY
// when the correction actually changes the time (duration or started_at); an
// unchanged time is carried forward, and time added where there was none gets a
// fresh linked entry. Both writes are in one transaction.
async function correctCall({
  original,
  patientId,
  organizationId,
  direction,
  reason,
  outcome,
  note,
  startedAt,
  durationSeconds,
}) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Preserve the original work attribution on both the call and its time.
    const staffUserId = original.staff_user_id;
    let newTimeEntryId = original.time_entry_id; // carry forward by default

    if (durationSeconds != null) {
      if (original.time_entry_id == null) {
        // Call previously had no billable time; add a fresh entry.
        const entry = await timeEntryService.createManualEntry(
          {
            patientId,
            staffUserId,
            organizationId,
            activityCategory: "patient_call",
            startedAt,
            durationSeconds,
            note,
          },
          conn
        );
        newTimeEntryId = entry.id;
      } else {
        const existing = await timeEntryService.getEntryById(
          original.time_entry_id,
          conn
        );
        // Compare at second granularity (DATETIME has no sub-second part).
        const existingStart = Math.floor(
          new Date(existing.started_at).getTime() / 1000
        );
        const newStart = Math.floor(startedAt.getTime() / 1000);
        const timeChanged =
          Number(existing.duration_seconds) !== durationSeconds ||
          existingStart !== newStart;

        if (timeChanged) {
          const corrected = await timeEntryService.createCorrection(
            {
              originalId: original.time_entry_id,
              patientId,
              staffUserId,
              organizationId,
              activityCategory: "patient_call",
              startedAt,
              durationSeconds,
              note,
            },
            conn
          );
          newTimeEntryId = corrected.id;
        }
        // else: time unchanged -> keep the existing linked entry
      }
    }

    const id = await insertCall(conn, {
      patientId,
      staffUserId,
      organizationId,
      timeEntryId: newTimeEntryId,
      direction,
      reason,
      outcome,
      note,
      startedAt,
      supersedes: original.id,
    });

    await conn.commit();
    return getCallById(id);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  getCallById,
  findCallSupersededBy,
  listHeadCallsForPatient,
  createCall,
  correctCall,
};
