// services/scheduledCall.service.js
//
// Call scheduling (#3). Scheduled calls are appointments (intent). The billable record is
// patient_calls; completion LINKS to it (completed_call_id), never duplicates it. See the
// migration header and MEDICATIONS/SCHEDULING notes.

const db = require("../config/db");
const { canAccessPatient } = require("./patientAccess");

function httpError(status, message) {
  const e = new Error(message);
  e.httpStatus = status;
  return e;
}

const SELECT = `
  SELECT sc.id, sc.patient_id, sc.organization_id, sc.scheduled_by, sc.scheduled_at,
         sc.reason, sc.status, sc.completed_call_id, sc.created_at, sc.updated_at,
         p.name AS patient_name, s.name AS scheduled_by_name
    FROM scheduled_calls sc
    JOIN users p ON p.id = sc.patient_id
    LEFT JOIN users s ON s.id = sc.scheduled_by
`;

async function getRowInOrg(id, orgScope) {
  const [rows] = await db.query(`${SELECT} WHERE sc.id = ?`, [id]);
  const row = rows[0];
  if (!row || Number(row.organization_id) !== Number(orgScope)) {
    throw httpError(404, "Scheduled call not found");
  }
  return row;
}

// Calendar: scheduled calls in the org within [from, to). Both are 'YYYY-MM-DD' (to is
// exclusive). Newest-intent ordering by time.
async function listForOrg(orgScope, { from, to }) {
  const [rows] = await db.query(
    `${SELECT} WHERE sc.organization_id = ? AND sc.scheduled_at >= ? AND sc.scheduled_at < ?
      ORDER BY sc.scheduled_at ASC`,
    [orgScope, from, to]
  );
  return rows;
}

// Overdue = still 'scheduled' and past its time (never logged). A patient nobody talked to.
async function listOverdue(orgScope) {
  const [rows] = await db.query(
    `${SELECT} WHERE sc.organization_id = ? AND sc.status = 'scheduled' AND sc.scheduled_at < NOW()
      ORDER BY sc.scheduled_at ASC`,
    [orgScope]
  );
  return rows;
}

async function create(actor, orgScope, { patient_id, scheduled_at, reason }) {
  if (!patient_id || !scheduled_at) throw httpError(400, "patient_id and scheduled_at are required");
  const allowed = await canAccessPatient(actor, orgScope, patient_id);
  if (!allowed) throw httpError(404, "Patient not found");
  const [result] = await db.query(
    `INSERT INTO scheduled_calls (patient_id, organization_id, scheduled_by, scheduled_at, reason, status)
     VALUES (?, ?, ?, ?, ?, 'scheduled')`,
    [patient_id, orgScope, actor.id, scheduled_at, (reason || "").trim().slice(0, 255) || null]
  );
  return getRowInOrg(result.insertId, orgScope);
}

// Reschedule / edit in place (v1 — no history; that's a followup).
async function update(actor, orgScope, id, { scheduled_at, reason }) {
  const row = await getRowInOrg(id, orgScope);
  if (row.status === "completed") throw httpError(409, "A completed call can't be rescheduled");
  await db.query(
    `UPDATE scheduled_calls SET
       scheduled_at = COALESCE(?, scheduled_at),
       reason = ?,
       updated_at = NOW()
     WHERE id = ?`,
    [scheduled_at || null, reason !== undefined ? (reason || "").trim().slice(0, 255) || null : row.reason, id]
  );
  return getRowInOrg(id, orgScope);
}

async function setStatus(actor, orgScope, id, status) {
  if (!["cancelled", "no_show"].includes(status)) throw httpError(400, "Invalid status");
  const row = await getRowInOrg(id, orgScope);
  if (row.status === "completed") throw httpError(409, "A completed call can't be changed");
  await db.query(`UPDATE scheduled_calls SET status = ?, updated_at = NOW() WHERE id = ?`, [status, id]);
  return getRowInOrg(id, orgScope);
}

// Complete = link to the documented patient_calls row created by the call-logging flow.
// Validates the call belongs to the same patient + org, so a schedule can't be marked
// complete by an unrelated call. Only after this is the schedule "complete".
async function complete(actor, orgScope, id, callId) {
  if (!callId) throw httpError(400, "call_id is required");
  const row = await getRowInOrg(id, orgScope);
  const [calls] = await db.query(
    `SELECT patient_id, organization_id FROM patient_calls WHERE id = ?`,
    [callId]
  );
  const call = calls[0];
  if (!call || Number(call.organization_id) !== Number(orgScope) || Number(call.patient_id) !== Number(row.patient_id)) {
    throw httpError(400, "That logged call doesn't match this scheduled call's patient");
  }
  await db.query(
    `UPDATE scheduled_calls SET status = 'completed', completed_call_id = ?, updated_at = NOW() WHERE id = ?`,
    [callId, id]
  );
  return getRowInOrg(id, orgScope);
}

module.exports = { listForOrg, listOverdue, create, update, setStatus, complete };
