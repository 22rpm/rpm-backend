// services/staffMessages.service.js
//
// The STAFF side of the patient-keyed, care-team-shared Messages inbox
// (CLINICIAN_SMS_DESIGN.md, Phase 1). Distinct from services/messageService.js,
// which serves the mobile app's 1:1 patient<->clinician DM endpoints.
//
// A "conversation" is all `messages` rows for one patient_id (the patient party).
// Both channels (in_app, sms) live in the same thread.
//
// VISIBILITY is org-wide for super-admin/admin/care_manager and assignment-scoped
// for clinicians — via services/patientAccess (assignmentScope / canAccessPatient).
// Those helpers are VISIBILITY ONLY; message ROUTING (who gets the email) is
// assignment-based and lives in messageNotify.service.js, never here.
//
// SHARED READ: an INBOUND row is one the patient sent (sender_id = patient_id).
// Its is_read means "the CARE TEAM has read it" — markThreadRead clears every
// unread inbound row for the patient at once, so it's read for everyone.

const db = require("../config/db");
const { assignmentScope, canAccessPatient } = require("./patientAccess");

class StaffMessagesService {
  // Inbox: one row per patient conversation in scope, unread-first then most-recent.
  // orgScope is req.orgScope (super-admin's selected org, else the user's own org).
  async getInbox(user, orgScope, limit = 200) {
    const scope = assignmentScope(user, "c.patient_id");
    const sql = `
      SELECT c.patient_id,
             u.name              AS patient_name,
             u.organization_id,
             c.last_message_time,
             c.unread_count,
             lm.message          AS last_message,
             lm.channel          AS last_channel,
             lm.sender_id        AS last_sender_id
      FROM (
        SELECT m.patient_id,
               MAX(m.created_at) AS last_message_time,
               SUM(CASE WHEN m.sender_id = m.patient_id AND m.is_read = 0
                        THEN 1 ELSE 0 END) AS unread_count
        FROM messages m
        WHERE m.patient_id IS NOT NULL
        GROUP BY m.patient_id
      ) c
      JOIN users u ON u.id = c.patient_id
      JOIN messages lm ON lm.id = (
        SELECT m2.id FROM messages m2
        WHERE m2.patient_id = c.patient_id
        ORDER BY m2.created_at DESC, m2.id DESC
        LIMIT 1
      )
      WHERE u.organization_id = ?
        ${scope.clause}
      ORDER BY (c.unread_count > 0) DESC, c.last_message_time DESC
      LIMIT ?`;
    const params = [orgScope, ...scope.params, Number(limit)];
    const [rows] = await db.query(sql, params);
    return rows.map((r) => ({
      patient_id: r.patient_id,
      patient_name: r.patient_name,
      last_message: r.last_message,
      last_channel: r.last_channel,
      last_message_time: r.last_message_time,
      // Is the most recent row inbound (patient sent it)? Drives the "reply waiting" affordance.
      last_inbound: r.last_sender_id === r.patient_id,
      unread_count: Number(r.unread_count) || 0,
    }));
  }

  // Total shared unread INBOUND messages in scope — the nav badge count.
  async getUnreadCount(user, orgScope) {
    const scope = assignmentScope(user, "m.patient_id");
    const sql = `
      SELECT COUNT(*) AS unread
      FROM messages m
      JOIN users u ON u.id = m.patient_id
      WHERE u.organization_id = ?
        AND m.sender_id = m.patient_id
        AND m.is_read = 0
        ${scope.clause}`;
    const params = [orgScope, ...scope.params];
    const [rows] = await db.query(sql, params);
    return Number(rows[0]?.unread) || 0;
  }

  // Full unified thread (both channels) for one patient, oldest-first.
  // ACCESS IS THE CALLER'S JOB — gate with canAccessPatient before calling.
  async getThread(patientId, limit = 200) {
    const sql = `
      SELECT m.id, m.patient_id, m.sender_id, m.receiver_id, m.message,
             m.channel, m.is_read, m.read_at, m.read_by,
             m.notification_log_id, m.created_at,
             s.name AS sender_name
      FROM messages m
      LEFT JOIN users s ON s.id = m.sender_id
      WHERE m.patient_id = ?
      ORDER BY m.created_at ASC, m.id ASC
      LIMIT ?`;
    const [rows] = await db.query(sql, [patientId, Number(limit)]);
    return rows.map((r) => ({
      ...r,
      // direction is derivable and convenient for the UI.
      direction: r.sender_id === r.patient_id ? "inbound" : "outbound",
    }));
  }

  // SHARED mark-read: clear every unread inbound row for this patient, for the
  // whole team. read_by/read_at record who opened it. Returns rows cleared.
  async markThreadRead(patientId, staffUserId) {
    const [result] = await db.query(
      `UPDATE messages
          SET is_read = 1, read_at = NOW(), read_by = ?
        WHERE patient_id = ?
          AND sender_id = patient_id
          AND is_read = 0`,
      [staffUserId, patientId]
    );
    return result?.affectedRows || 0;
  }

  // Re-export for controllers that need the point check.
  canAccessPatient(user, orgScope, patientId) {
    return canAccessPatient(user, orgScope, patientId);
  }
}

module.exports = new StaffMessagesService();
