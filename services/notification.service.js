// services/notification.service.js
//
// The automated patient-notification engine: consent/opt-out, the per-patient
// settings, and the send pipeline that gates on opt-out BEFORE every send and logs
// every outcome (sent, skipped, failed) so nothing fails silently.
//
// Two load-bearing rules (see NOTIFICATIONS_DESIGN):
//  1. Opt-out survives everything failing. The opt-out check is FAIL-CLOSED (a
//     pref-read error skips the send, never sends), and a Twilio 21610 (carrier
//     STOP) on a send SELF-HEALS our opt-out record — so a missed STOP webhook is
//     repaired by the next send attempt rather than leaving the patient opted-in.
//  2. Failures surface. Every attempt is a notification_log row; failures and
//     undelivered are queryable, and getHealth() flags a systemic outage AND
//     patients repeatedly skipped for the UNINTENDED reason (a failing pref read),
//     which otherwise looks identical to a real opt-out.

const db = require("../config/db");
const twilio = require("./twillio.service");
const { TYPES, AUTO_ACK_BODY } = require("../config/notifications");
const { pacificDay } = require("./messageNotify.service");
const { ROLES } = require("../config/roles");

// Roles that may ATTEST clinical-SMS consent — the actual clinical staff, from the
// shared role constants (config/roles.js), not bare strings. No named group is exactly
// this pair (CONSENT_ROLES is clinician+super-admin; CLINICAL_STAFF adds admin), so it's
// composed here.
const CLINICAL_ATTESTER_ROLES = [ROLES.CLINICIAN, ROLES.CARE_MANAGER];

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || null;

// ---------------------------------------------------------------------------
// Consent + opt-out (patient_comm_prefs)
// ---------------------------------------------------------------------------

async function getPrefs(patientId) {
  const [rows] = await db.query(
    "SELECT * FROM patient_comm_prefs WHERE patient_id = ? LIMIT 1",
    [patientId]
  );
  return rows[0] || null;
}

// Set/clear SMS consent (opt-in). Separate from RPM consent by design.
async function setConsent({ patientId, consent, actorId }) {
  await db.query(
    `INSERT INTO patient_comm_prefs (patient_id, sms_consent, sms_consent_at, sms_consent_by)
     VALUES (?, ?, ${consent ? "NOW()" : "NULL"}, ?)
     ON DUPLICATE KEY UPDATE
       sms_consent = VALUES(sms_consent),
       sms_consent_at = ${consent ? "NOW()" : "sms_consent_at"},
       sms_consent_by = ${consent ? "VALUES(sms_consent_by)" : "sms_consent_by"},
       updated_at = NOW()`,
    [patientId, consent ? 1 : 0, actorId ?? null]
  );
  return getPrefs(patientId);
}

// Record/revoke the SEPARATE clinical-SMS consent (free-text clinical texting) — distinct
// from sms_consent (reminders) and from RPM consent. The wording `version` is stamped by
// the caller from a server-side constant, never the client. On GRANT: set the flag +
// _at=NOW() + _by=actor + _version. On REVOKE: clear the flag but KEEP the historical
// _at/_by/_version (the record of the last grant), mirroring setConsent.
async function setClinicalConsent({ patientId, consent, version, actorId }) {
  await db.query(
    `INSERT INTO patient_comm_prefs
       (patient_id, sms_clinical_consent, sms_clinical_consent_at,
        sms_clinical_consent_by, sms_clinical_consent_version)
     VALUES (?, ?, ${consent ? "NOW()" : "NULL"}, ?, ?)
     ON DUPLICATE KEY UPDATE
       sms_clinical_consent = VALUES(sms_clinical_consent),
       sms_clinical_consent_at = ${consent ? "NOW()" : "sms_clinical_consent_at"},
       sms_clinical_consent_by = ${consent ? "VALUES(sms_clinical_consent_by)" : "sms_clinical_consent_by"},
       sms_clinical_consent_version = ${consent ? "VALUES(sms_clinical_consent_version)" : "sms_clinical_consent_version"},
       updated_at = NOW()`,
    [patientId, consent ? 1 : 0, actorId ?? null, consent ? version : null]
  );
  return getPrefs(patientId);
}

// Does this user hold an actual CLINICAL role (clinician or care_manager) AND is the
// account active? Consent ATTESTATION requires both: a management-only admin/super-admin
// passes the coarse CLINICAL_STAFF route gate but must NOT attest, and a DEACTIVATED
// clinician (e.g. the old test account) must not either. Checks the role table (a user
// may hold several roles — a super-admin who is ALSO an active clinician passes) joined
// to users for the active check (u.is_active = 1, matching the rest of the codebase).
async function actorHoldsClinicalRole(userId) {
  const [rows] = await db.query(
    `SELECT 1 FROM role r
       JOIN users u ON u.id = r.user_id
      WHERE r.user_id = ? AND r.role_type IN (?) AND u.is_active = 1
      LIMIT 1`,
    [userId, CLINICAL_ATTESTER_ROLES]
  );
  return rows.length > 0;
}

// Opt OUT — idempotent upsert. `source` records which of the three layers set it.
async function setOptOut({ patientId, source }) {
  await db.query(
    `INSERT INTO patient_comm_prefs (patient_id, opted_out, opted_out_at, opted_out_source)
     VALUES (?, 1, NOW(), ?)
     ON DUPLICATE KEY UPDATE
       opted_out = 1, opted_out_at = NOW(), opted_out_source = VALUES(opted_out_source),
       updated_at = NOW()`,
    [patientId, source || "unknown"]
  );
}

// Re-subscribe (START). Clears the kill switch; consent still governs sending.
async function clearOptOut({ patientId, source }) {
  await db.query(
    `INSERT INTO patient_comm_prefs (patient_id, opted_out, opted_out_at, opted_out_source)
     VALUES (?, 0, NULL, ?)
     ON DUPLICATE KEY UPDATE
       opted_out = 0, opted_out_at = NULL, opted_out_source = VALUES(opted_out_source),
       updated_at = NOW()`,
    [patientId, source || "start_keyword"]
  );
}

// ---------------------------------------------------------------------------
// Per-patient per-type settings (toggles)
// ---------------------------------------------------------------------------

async function getSettings(patientId) {
  const [rows] = await db.query(
    "SELECT type, enabled, cadence_days FROM patient_notification_settings WHERE patient_id = ?",
    [patientId]
  );
  return rows;
}

async function upsertSetting({ patientId, type, enabled, cadenceDays, actorId }) {
  if (!TYPES[type]) {
    const e = new Error(`Unknown notification type: ${type}`);
    e.httpStatus = 400;
    throw e;
  }
  await db.query(
    `INSERT INTO patient_notification_settings (patient_id, type, enabled, cadence_days, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       enabled = VALUES(enabled), cadence_days = VALUES(cadence_days),
       updated_by = VALUES(updated_by), updated_at = NOW()`,
    [patientId, type, enabled ? 1 : 0, cadenceDays ?? null, actorId ?? null]
  );
}

// ---------------------------------------------------------------------------
// The send pipeline
// ---------------------------------------------------------------------------

async function loadSendContext(patientId) {
  const [rows] = await db.query(
    `SELECT u.id, u.phoneNumber, u.organization_id, o.name AS clinic_name, o.timezone
       FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id
      WHERE u.id = ? LIMIT 1`,
    [patientId]
  );
  return rows[0] || null;
}

async function insertLog(row) {
  const [res] = await db.query(
    `INSERT INTO notification_log
       (patient_id, organization_id, type, channel, direction, to_number, body,
        twilio_sid, status, skip_reason, error_code, error_message, scheduled_for, sent_at)
     VALUES (?, ?, ?, 'sms', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.patient_id,
      row.organization_id ?? null,
      row.type,
      row.direction || "outbound",
      row.to_number ?? null,
      row.body ?? null,
      row.twilio_sid ?? null,
      row.status,
      row.skip_reason ?? null,
      row.error_code ?? null,
      row.error_message ?? null,
      row.scheduled_for ?? null,
      row.sent_at ?? null,
    ]
  );
  return res.insertId;
}

// Mirror an inbound SMS reply into the patient-keyed `messages` thread so it shows
// in the Messages inbox and drives the shared unread + email alert. receiver_id is
// only for the NOT NULL constraint + the mobile 1:1 pairing — the STAFF inbox keys
// on patient_id, not receiver. Prefer an assigned clinician; fall back to the patient
// (a harmless self-reference) if the org has no assignment. channel='sms', is_read=0.
async function insertInboundMessageRow({ patientId, body, notificationLogId }) {
  let receiverId = patientId;
  const [rows] = await db.query(
    `SELECT u.id FROM users u
       JOIN role r ON r.user_id = u.id AND r.role_type = 'clinician'
       JOIN patient_doctor_assignments pda ON pda.doctor_id = u.id
      WHERE pda.patient_id = ? AND u.is_active = 1
      LIMIT 1`,
    [patientId]
  );
  if (rows[0]) receiverId = rows[0].id;
  const now = new Date();
  const [res] = await db.query(
    `INSERT INTO messages
       (sender_id, receiver_id, message, patient_id, channel, is_read,
        notification_log_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'sms', 0, ?, ?, ?)`,
    [patientId, receiverId, body || "", patientId, notificationLogId, now, now]
  );
  return res.insertId;
}

// Store an inbound patient SMS reply (a non-keyword message — STOP/START/HELP are
// handled as commands separately). This is what the webhook used to drop.
// Now ALSO: mirror it into the Messages thread and fire the no-PHI, once-per-day
// care-team email alert (CLINICIAN_SMS_DESIGN.md Phase 1 — the Sept-17 fix).
async function recordInboundReply({ patientId, organizationId, from, body }) {
  const logId = await insertLog({
    patient_id: patientId,
    organization_id: organizationId ?? null,
    type: "reply",
    direction: "inbound",
    to_number: from || null,
    body: body || null,
    status: "received",
  });

  // Surface it in the unified Messages thread. Never let a mirror failure break
  // inbound handling — the notification_log row (the compliance record) is written.
  try {
    const messageId = await insertInboundMessageRow({
      patientId,
      body: body || "",
      notificationLogId: logId,
    });
    if (messageId) {
      await db.query("UPDATE notification_log SET message_id = ? WHERE id = ?", [
        messageId,
        logId,
      ]);
    }
  } catch (e) {
    console.error("recordInboundReply: messages mirror failed:", e.message);
  }

  // No-PHI, once-per-patient-per-day care-team email alert (fire-and-forget).
  // organizationId is already known here (may be null → super-admins only).
  require("./messageNotify.service")
    .notifyInboundMessage({ patientId, organizationId: organizationId ?? null })
    .catch(() => {});

  // Auto-acknowledge the patient (P1-7): once per Pacific day, no PHI, sets the
  // reply-window expectation + the 911 emergency backstop. Fire-and-forget.
  maybeSendAutoAck({ patientId }).catch(() => {});

  return logId;
}

// Send a one-per-day no-PHI auto-acknowledgement to a patient who texted the clinic
// (CLINICIAN_SMS_DESIGN P1-7 / gate item 5). This is the safety net for the window
// between "patient sent" and "a human read it": it tells them when to expect a reply
// and to call 911 in an emergency.
//
// message_autoack_log UNIQUE(patient_id, acked_on) is the once-per-day lock. We
// respect the STOP kill switch (opted_out) but deliberately do NOT gate on
// sms_consent — this is a transactional reply to an inbound text, not an automated
// reminder (same rationale as the existing HELP auto-reply).
async function maybeSendAutoAck({ patientId }) {
  try {
    if (!patientId) return;
    const day = pacificDay();

    // Claim today's slot — the UNIQUE index is the concurrency lock.
    try {
      await db.query(
        "INSERT INTO message_autoack_log (patient_id, acked_on) VALUES (?, ?)",
        [patientId, day]
      );
    } catch (e) {
      if (e && (e.code === "ER_DUP_ENTRY" || e.errno === 1062)) return;
      throw e;
    }

    const releaseSlot = () =>
      db
        .query(
          "DELETE FROM message_autoack_log WHERE patient_id = ? AND acked_on = ?",
          [patientId, day]
        )
        .catch(() => {});

    const prefs = await getPrefs(patientId);
    const ctx = await loadSendContext(patientId);
    const to =
      ctx && ctx.phoneNumber ? twilio.formatPhoneNumber(ctx.phoneNumber) : null;

    // Opted out (STOP) or unreachable → don't send; release the slot so a later
    // inbound can retry if the situation changes (e.g. START).
    if (!ctx || !to || (prefs && prefs.opted_out)) {
      await releaseSlot();
      return;
    }

    const body = AUTO_ACK_BODY({ clinicName: ctx.clinic_name });
    const statusCallback = PUBLIC_BASE_URL
      ? `${PUBLIC_BASE_URL.replace(/\/$/, "")}/api/notifications/sms-status`
      : undefined;
    const result = await twilio.sendSMS(
      to,
      body,
      statusCallback ? { statusCallback } : {}
    );

    await insertLog({
      patient_id: patientId,
      organization_id: ctx.organization_id ?? null,
      type: "auto_ack",
      direction: "outbound",
      to_number: to,
      body,
      twilio_sid: result.messageId ?? null,
      status: result.success ? "sent" : "failed",
      error_code: result.code ? String(result.code) : null,
      error_message: result.success ? null : result.error || null,
      sent_at: result.success ? new Date() : null,
    });

    if (!result.success) {
      // Carrier-level STOP surfaced on send — self-heal our opt-out record (rule #1).
      if (result.code === 21610) {
        await setOptOut({ patientId, source: "twilio_21610" });
      }
      await releaseSlot();
    }
  } catch (err) {
    console.error("maybeSendAutoAck error:", err.message);
  }
}

// Mark every unacknowledged inbound reply for a patient as seen (clears the
// "reply waiting" signal). Returns how many were cleared.
async function acknowledgeInbound({ patientId, actorId }) {
  const [res] = await db.query(
    `UPDATE notification_log
        SET acknowledged_at = NOW(), acknowledged_by = ?
      WHERE patient_id = ? AND direction = 'inbound' AND acknowledged_at IS NULL`,
    [actorId ?? null, patientId]
  );
  return res.affectedRows || 0;
}

// Unacknowledged-inbound summary per patient for a set of ids (patient-list badge):
// { [patient_id]: { count, oldest } }. Oldest drives the aging emphasis.
async function unreadInboundByPatient(patientIds) {
  const map = {};
  if (!patientIds || !patientIds.length) return map;
  const [rows] = await db.query(
    `SELECT patient_id, COUNT(*) AS count, MIN(created_at) AS oldest
       FROM notification_log
      WHERE direction = 'inbound' AND acknowledged_at IS NULL
        AND patient_id IN (?)
      GROUP BY patient_id`,
    [patientIds]
  );
  for (const r of rows) map[r.patient_id] = { count: Number(r.count), oldest: r.oldest };
  return map;
}

// Send one notification of `type` to one patient. Returns { outcome, ... }.
// NEVER throws for a normal skip/failure — it records and returns, so a caller
// (scheduler) can keep going. Only truly unexpected bugs propagate.
async function sendNotification({ patientId, type }) {
  const def = TYPES[type];
  if (!def) {
    const e = new Error(`Unknown notification type: ${type}`);
    e.httpStatus = 400;
    throw e;
  }

  let ctx;
  try {
    ctx = await loadSendContext(patientId);
  } catch (err) {
    // Fail closed: if we can't even load context, skip and surface it.
    await safeLog({ patient_id: patientId, type, status: "skipped", skip_reason: "error", error_message: "context load failed" });
    return { outcome: "error", reason: "context" };
  }
  if (!ctx) return { outcome: "error", reason: "no_patient" };

  // OPT-OUT / CONSENT GATE — fail-closed. A pref-read error skips (never sends).
  let prefs;
  try {
    prefs = await getPrefs(patientId);
  } catch (err) {
    await safeLog({ patient_id: patientId, organization_id: ctx.organization_id, type, status: "skipped", skip_reason: "error", error_message: "prefs read failed" });
    return { outcome: "skipped", reason: "error" };
  }
  if (!prefs || !prefs.sms_consent) {
    await safeLog({ patient_id: patientId, organization_id: ctx.organization_id, type, status: "skipped", skip_reason: "no_consent" });
    return { outcome: "skipped", reason: "no_consent" };
  }
  if (prefs.opted_out) {
    await safeLog({ patient_id: patientId, organization_id: ctx.organization_id, type, status: "skipped", skip_reason: "opted_out" });
    return { outcome: "skipped", reason: "opted_out" };
  }

  const to = twilio.formatPhoneNumber(ctx.phoneNumber);
  const body = def.body({ clinicName: ctx.clinic_name || "Your clinic" });
  if (!to) {
    await safeLog({ patient_id: patientId, organization_id: ctx.organization_id, type, body, status: "failed", error_code: "no_phone", error_message: "patient has no phone number" });
    return { outcome: "failed", reason: "no_phone" };
  }

  const logId = await insertLog({
    patient_id: patientId,
    organization_id: ctx.organization_id,
    type,
    to_number: to,
    body,
    status: "queued",
    scheduled_for: new Date(),
  });

  const statusCallback = PUBLIC_BASE_URL
    ? `${PUBLIC_BASE_URL.replace(/\/$/, "")}/api/notifications/sms-status`
    : undefined;
  const res = await twilio.sendSMS(to, body, { statusCallback });

  if (res.success) {
    await db.query(
      "UPDATE notification_log SET status = 'sent', twilio_sid = ?, sent_at = NOW() WHERE id = ?",
      [res.messageId || null, logId]
    );
    return { outcome: "sent", sid: res.messageId };
  }

  // SELF-HEAL: a 21610 means Twilio's own STOP blocked it — the patient opted out
  // and our webhook may have been missed. Record the opt-out from the failed send.
  if (String(res.code) === "21610") {
    await setOptOut({ patientId, source: "twilio_21610" });
  }
  await db.query(
    "UPDATE notification_log SET status = 'failed', error_code = ?, error_message = ? WHERE id = ?",
    [res.code ? String(res.code) : null, (res.error || "send failed").slice(0, 255), logId]
  );
  return { outcome: "failed", code: res.code };
}

// Logging must never itself throw out of the pipeline.
async function safeLog(row) {
  try {
    await insertLog(row);
  } catch (err) {
    console.error("notification_log insert failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Delivery status callback (Twilio -> us)
// ---------------------------------------------------------------------------

// Map Twilio MessageStatus to our status; record delivered/undelivered/failed.
async function recordDeliveryStatus({ sid, messageStatus, errorCode }) {
  if (!sid) return;
  const s = String(messageStatus || "").toLowerCase();
  if (s === "delivered") {
    await db.query(
      "UPDATE notification_log SET status = 'delivered', delivered_at = NOW() WHERE twilio_sid = ?",
      [sid]
    );
  } else if (s === "undelivered" || s === "failed") {
    await db.query(
      "UPDATE notification_log SET status = ?, error_code = COALESCE(?, error_code) WHERE twilio_sid = ?",
      [s, errorCode ? String(errorCode) : null, sid]
    );
  }
  // queued/sent/sending are interim — leave the row as 'sent'.
}

// ---------------------------------------------------------------------------
// Health + failures (surface silent outages and silently-skipped patients)
// ---------------------------------------------------------------------------

async function getFailures({ orgScope, limit = 50 }) {
  const [rows] = await db.query(
    `SELECT id, patient_id, type, status, error_code, error_message, created_at
       FROM notification_log
      WHERE organization_id = ? AND status IN ('failed', 'undelivered')
      ORDER BY created_at DESC
      LIMIT ?`,
    [orgScope, Number(limit)]
  );
  return rows;
}

async function getHealth({ orgScope }) {
  // Attempted = a real send was tried (not a skip). Succeeded = sent or delivered.
  const [countRows] = await db.query(
    `SELECT
       SUM(status IN ('sent','delivered','undelivered','failed') AND created_at >= NOW() - INTERVAL 1 DAY) AS attempted_24h,
       SUM(status IN ('sent','delivered') AND created_at >= NOW() - INTERVAL 1 DAY) AS succeeded_24h,
       SUM(status IN ('sent','delivered','undelivered','failed') AND created_at >= NOW() - INTERVAL 7 DAY) AS attempted_7d,
       SUM(status IN ('sent','delivered') AND created_at >= NOW() - INTERVAL 7 DAY) AS succeeded_7d
     FROM notification_log WHERE organization_id = ?`,
    [orgScope]
  );
  const c = countRows[0] || {};
  const [lastRows] = await db.query(
    "SELECT MAX(sent_at) AS last_success_at FROM notification_log WHERE organization_id = ? AND status IN ('sent','delivered')",
    [orgScope]
  );
  const last = lastRows[0] || {};
  // Patients repeatedly skipped for the UNINTENDED reason (a failing pref/context
  // read). A patient silently skipped for weeks by an error looks identical to an
  // opted-out one — surface them so the two aren't confused.
  const [errorSkips] = await db.query(
    `SELECT patient_id, COUNT(*) AS skips, MAX(created_at) AS last_skip
       FROM notification_log
      WHERE organization_id = ? AND status = 'skipped' AND skip_reason = 'error'
        AND created_at >= NOW() - INTERVAL 7 DAY
      GROUP BY patient_id
      HAVING skips >= 3
      ORDER BY skips DESC`,
    [orgScope]
  );

  const attempted24 = Number(c.attempted_24h || 0);
  const succeeded24 = Number(c.succeeded_24h || 0);
  return {
    attempted_24h: attempted24,
    succeeded_24h: succeeded24,
    attempted_7d: Number(c.attempted_7d || 0),
    succeeded_7d: Number(c.succeeded_7d || 0),
    last_success_at: last.last_success_at || null,
    // The "Twilio silently down" signal: we tried and NOTHING got through.
    systemic_failure: attempted24 > 0 && succeeded24 === 0,
    repeated_error_skips: errorSkips, // [{patient_id, skips, last_skip}]
  };
}

// ---------------------------------------------------------------------------
// Compliance dedupe helper (used by the scheduler for reading reminders)
// ---------------------------------------------------------------------------

// Has the patient transmitted any reading within `days`? If so, don't nag them.
async function hasRecentReading(patientId, days) {
  const [rows] = await db.query(
    "SELECT 1 FROM dev_data WHERE user_id = ? AND created_at >= NOW() - INTERVAL ? DAY LIMIT 1",
    [patientId, Number(days)]
  );
  return rows.length > 0;
}

// Was a notification of this type already logged (sent/queued) to this patient
// today? Idempotency guard so a scheduler re-run can't double-send.
async function sentTypeToday(patientId, type) {
  const [rows] = await db.query(
    `SELECT 1 FROM notification_log
      WHERE patient_id = ? AND type = ?
        AND status IN ('queued','sent','delivered','undelivered')
        AND created_at >= CURDATE()
      LIMIT 1`,
    [patientId, type]
  );
  return rows.length > 0;
}

// Was this type sent to this patient within the last `days`? (call_prompt guard —
// at most one prompt per upcoming call, not one per scheduler tick.)
async function sentTypeWithinDays(patientId, type, days) {
  const [rows] = await db.query(
    `SELECT 1 FROM notification_log
      WHERE patient_id = ? AND type = ?
        AND status IN ('queued','sent','delivered','undelivered')
        AND created_at >= NOW() - INTERVAL ? DAY
      LIMIT 1`,
    [patientId, type, Number(days)]
  );
  return rows.length > 0;
}

// Log a deliberate skip (e.g. compliant patient) so the dedupe is VISIBLE in the
// log rather than an invisible non-event.
async function recordSkip({ patientId, organizationId, type, reason }) {
  await safeLog({ patient_id: patientId, organization_id: organizationId ?? null, type, status: "skipped", skip_reason: reason });
}

// The reading-reminder cadence configured for a patient (default 3).
async function readingCadence(patientId) {
  const [rows] = await db.query(
    "SELECT cadence_days FROM patient_notification_settings WHERE patient_id = ? AND type = 'reading_reminder' LIMIT 1",
    [patientId]
  );
  return (rows[0] && rows[0].cadence_days) || 3;
}

// On-demand send: a clinician/admin fires an existing template NOW rather than
// waiting for the schedule. Same pipeline (consent + opt-out + log), with two
// deliberate differences from the scheduler:
//   - NO send window. A person choosing to send at 8pm is deliberate; the 9–6
//     window only exists to stop the scheduler firing overnight.
//   - Compliance dedupe still applies to reading_reminder, but is a WARNING, not
//     a hard block: without `force`, a current patient returns { outcome:
//     "compliant" } and nothing is sent; the caller can re-send with force=true.
// Consent and opt-out are NEVER overridable by force — only compliance is.
async function sendOnDemand({ patientId, type, force }) {
  const def = TYPES[type];
  if (!def || !def.live) {
    const e = new Error(`Cannot send type on demand: ${type}`);
    e.httpStatus = 400;
    throw e;
  }
  if (type === "reading_reminder" && !force) {
    const cadence = await readingCadence(patientId);
    if (await hasRecentReading(patientId, cadence)) {
      return { outcome: "compliant", cadence };
    }
  }
  return sendNotification({ patientId, type });
}

// The per-patient notification log (for the patient's Notifications tab).
async function getPatientLog(patientId, limit = 50) {
  const [rows] = await db.query(
    `SELECT id, type, direction, body, status, skip_reason, error_code, error_message,
            created_at, sent_at, delivered_at, acknowledged_at
       FROM notification_log
      WHERE patient_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
    [patientId, Number(limit)]
  );
  return rows;
}

module.exports = {
  getPrefs,
  setConsent,
  setClinicalConsent,
  actorHoldsClinicalRole,
  setOptOut,
  clearOptOut,
  getSettings,
  upsertSetting,
  sendNotification,
  recordDeliveryStatus,
  getFailures,
  getHealth,
  hasRecentReading,
  sentTypeToday,
  sentTypeWithinDays,
  recordSkip,
  sendOnDemand,
  getPatientLog,
  recordInboundReply,
  acknowledgeInbound,
  unreadInboundByPatient,
};
