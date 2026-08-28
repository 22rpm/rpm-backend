// services/audit.service.js
//
// Append-only audit trail. Records who did what, to which record, when.
//
// Design rules:
//   1. Never throw. A failed audit write must not break the user's request —
//      but it must be loud in the logs so the gap is noticed.
//   2. Never store PHI values in metadata. Reference records by id. The audit
//      log is queried during investigations and should not itself become a
//      second copy of patient data.
//   3. Never update or delete rows. There is deliberately no such function
//      in this module.

const db = require("../config/db");

// Canonical action names. Using constants rather than free-form strings keeps
// the log queryable — 'patient.view' and 'viewed_patient' would otherwise both
// end up in the table.
const ACTIONS = {
  // Authentication
  LOGIN_SUCCESS: "auth.login_success",
  LOGIN_FAILURE: "auth.login_failure",
  LOGOUT: "auth.logout",
  OTP_SENT: "auth.otp_sent",
  OTP_VERIFIED: "auth.otp_verified",
  DEVICE_TRUSTED: "auth.device_trusted",

  // PHI access — the ones 164.312(b) is actually about
  PATIENT_VIEW: "patient.view",
  PATIENT_LIST_VIEW: "patient.list_view",
  VITALS_VIEW: "vitals.view",
  VITALS_EXPORT: "vitals.export",

  // Record changes
  PATIENT_CREATE: "patient.create",
  PATIENT_UPDATE: "patient.update",
  // Enrollment date is a distinct compliance event (it drives billing periods),
  // searchable on its own rather than folded into patient.update.
  PATIENT_ENROLLMENT_CHANGE: "patient.enrollment_change",
  PATIENT_CONSENT_RECORDED: "patient.consent_recorded",
  DOCTOR_CREATE: "doctor.create",
  ADMIN_CREATE: "admin.create",
  USER_DEACTIVATE: "user.deactivate",
  ROLE_CHANGE: "user.role_change",
  PASSWORD_RESET: "user.password_reset",

  // Organizations
  ORG_CREATE: "org.create",
  ORG_UPDATE: "org.update",
  ORG_VIEW: "org.view",
  ORG_CONTEXT_SWITCH: "org.context_switch",

  // Invitations
  INVITATION_ISSUED: "invitation.issued",
  INVITATION_RESENT: "invitation.resent",
  INVITATION_ACCEPTED: "invitation.accepted",

  // Clinical workflow
  ALERT_RESOLVED: "alert.resolved",
  ASSIGNMENT_CREATE: "assignment.create",

  // Billing documents
  RPM_NOTE_SIGNED: "rpm_note.signed",
};

/**
 * Record an audit event.
 *
 * @param {object}  entry
 * @param {object}  [entry.req]           Express request — used for actor, IP, user agent
 * @param {number}  [entry.actorId]       Overrides req.user.id (e.g. failed login, no session)
 * @param {string}  [entry.actorRole]     Overrides req.user.role_type
 * @param {string}   entry.action         One of ACTIONS
 * @param {string}   entry.entityType     'patient' | 'organization' | 'user' | ...
 * @param {number}  [entry.entityId]
 * @param {number}  [entry.organizationId]
 * @param {object}  [entry.metadata]      Ids and flags only — no PHI values
 */
async function record(entry) {
  try {
    const req = entry.req;

    const actorId =
      entry.actorId !== undefined ? entry.actorId : req?.user?.id ?? null;

    const actorRole =
      entry.actorRole ||
      req?.user?.role_type ||
      req?.user?.role ||
      "anonymous";

    const organizationId =
      entry.organizationId !== undefined
        ? entry.organizationId
        : req?.user?.org_id ?? null;

    const ipAddress = req
      ? (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
        req.ip ||
        null
      : null;

    const userAgent = req ? req.headers["user-agent"] || null : null;

    if (!entry.action || !entry.entityType) {
      console.error("Audit: missing action or entityType", entry);
      return;
    }

    await db.query(
      `INSERT INTO audit_log
        (actor_id, actor_role, action, entity_type, entity_id,
         organization_id, ip_address, user_agent, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actorId,
        String(actorRole).slice(0, 50),
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        organizationId,
        ipAddress ? String(ipAddress).slice(0, 100) : null,
        userAgent ? String(userAgent).slice(0, 512) : null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
      ]
    );
  } catch (err) {
    // Deliberately swallowed: a failed audit write must not break the request.
    // Logged at error level so the gap is visible in monitoring.
    console.error("AUDIT WRITE FAILED:", err.message, {
      action: entry?.action,
      entityType: entry?.entityType,
      entityId: entry?.entityId,
    });
  }
}

/**
 * Fire-and-forget variant for hot paths (list views, reading fetches) where
 * awaiting the insert would add latency to every request.
 */
function recordAsync(entry) {
  record(entry).catch(() => {});
}

/**
 * TRANSACTIONAL variant. Writes on the caller's connection and DELIBERATELY
 * THROWS on failure, so the audit row commits or rolls back atomically with the
 * caller's business write. Use only where the audit entry must not be able to
 * succeed or fail independently — e.g. anchoring a signed-note hash. Unlike
 * record(), it parses no req: pass explicit fields.
 *
 * @param {object} conn   an active mysql2 transaction connection
 * @param {object} entry  { actorId, actorRole, action, entityType, entityId,
 *                          organizationId, ipAddress, userAgent, metadata }
 */
async function recordInTx(conn, entry) {
  if (!entry.action || !entry.entityType)
    throw new Error("audit.recordInTx: action and entityType are required");
  await conn.query(
    `INSERT INTO audit_log
        (actor_id, actor_role, action, entity_type, entity_id,
         organization_id, ip_address, user_agent, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.actorId ?? null,
      String(entry.actorRole || "anonymous").slice(0, 50),
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.organizationId ?? null,
      entry.ipAddress ? String(entry.ipAddress).slice(0, 100) : null,
      entry.userAgent ? String(entry.userAgent).slice(0, 512) : null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    ]
  );
}

module.exports = { record, recordAsync, recordInTx, ACTIONS };