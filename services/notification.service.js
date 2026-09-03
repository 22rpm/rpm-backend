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
const { TYPES } = require("../config/notifications");

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

// Store an inbound patient SMS reply (a non-keyword message — STOP/START/HELP are
// handled as commands separately). This is what the webhook used to drop.
async function recordInboundReply({ patientId, organizationId, from, body }) {
  return insertLog({
    patient_id: patientId,
    organization_id: organizationId ?? null,
    type: "reply",
    direction: "inbound",
    to_number: from || null,
    body: body || null,
    status: "received",
  });
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
