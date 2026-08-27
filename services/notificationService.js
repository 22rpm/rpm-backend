// services/notificationService.js
// Notify a patient's assigned physician when the patient sends a message.
// - NO PHI: deep link only, no body/name/id (buildContent).
// - Assignment + active gated; no active assignee -> org-admin fallback -> else
//   logged 'unroutable' (never a silent drop; ORG_CONTEXT_FOLLOWUPS #6).
// - Every send attempt is recorded in notification_deliveries (sent/accepted/failed/
//   unroutable/skipped) so nothing fails silently — Twilio + Gmail were both down for
//   months. Drives the dashboard failure indicator.
// - Debounce: at most one notification per (patient -> recipient) per 30 min, so a
//   burst of messages doesn't become a burst of texts. First message goes out now.

const db = require("../config/knex");
const twilioService = require("../services/twillio.service");
const { sendNotificationEmail } = require("../services/mail.service");

const DEBOUNCE_MINUTES = 30;
const DASHBOARD_URL = process.env.DASHBOARD_URL || "https://rmtrpm.duckdns.org";
const DEEP_LINK = `${DASHBOARD_URL}/communication`;
const PUBLIC_API = process.env.PUBLIC_BASE_URL || "https://rmtrpm.duckdns.org/rpm-be";
const SMS_STATUS_CALLBACK = `${PUBLIC_API}/api/messages/notifications/twilio-status`;
const FAILURE_STATUSES = ["failed", "undelivered", "unroutable"];
const PERMANENT_SMS_CODES = [21211, 21408, 21610, 21614]; // invalid/unreachable — don't retry

async function recordDelivery(row) {
  try {
    const [id] = await db("notification_deliveries").insert({
      type: "message",
      recipient_user_id: row.recipientUserId || null,
      patient_id: row.patientId || null,
      channel: row.channel,
      status: row.status,
      provider_ref: row.providerRef || null,
      provider_status: row.providerStatus || null,
      error: row.error || null,
      attempts: row.attempts || 1,
      created_at: new Date(),
      updated_at: new Date(),
    });
    return id;
  } catch (e) {
    console.error("notification: failed to record delivery:", e.message);
  }
}

// Twilio StatusCallback -> flip accepted -> delivered/undelivered by message SID.
async function updateDeliveryByProviderRef(sid, providerStatus) {
  if (!sid) return;
  const mapped =
    providerStatus === "delivered" ? "delivered"
    : providerStatus === "undelivered" || providerStatus === "failed" ? "undelivered"
    : null;
  try {
    await db("notification_deliveries")
      .where("provider_ref", sid)
      .update({ provider_status: providerStatus, ...(mapped ? { status: mapped } : {}), updated_at: new Date() });
  } catch (e) {
    console.error("notification: status callback update failed:", e.message);
  }
}

async function getPrefs(userId) {
  const row = await db("notification_preferences").where("user_id", userId).first();
  return { message_email: row ? !!row.message_email : true, message_sms: row ? !!row.message_sms : true };
}

async function setPrefs(userId, { message_email, message_sms }) {
  const existing = await db("notification_preferences").where("user_id", userId).first();
  const patch = {};
  if (typeof message_email === "boolean") patch.message_email = message_email;
  if (typeof message_sms === "boolean") patch.message_sms = message_sms;
  if (existing) {
    await db("notification_preferences").where("user_id", userId).update({ ...patch, updated_at: new Date() });
  } else {
    await db("notification_preferences").insert({
      user_id: userId,
      message_email: patch.message_email ?? true,
      message_sms: patch.message_sms ?? true,
    });
  }
  return getPrefs(userId);
}

async function getRecentFailures({ hours = 72, limit = 50 } = {}) {
  const since = new Date(Date.now() - hours * 3600 * 1000);
  return db("notification_deliveries")
    .whereIn("status", FAILURE_STATUSES)
    .andWhere("created_at", ">=", since)
    .orderBy("created_at", "desc")
    .limit(limit);
}

async function getFailureCount({ hours = 72 } = {}) {
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const [{ c }] = await db("notification_deliveries")
    .whereIn("status", FAILURE_STATUSES)
    .andWhere("created_at", ">=", since)
    .count({ c: "*" });
  return Number(c || 0);
}

// Active assigned physician(s); else the patient's org admins; else nobody.
async function resolveRecipients(patientId) {
  const active = await db("users")
    .select("users.id", "users.name", "users.email", "users.phoneNumber", "users.organization_id")
    .innerJoin("role", "users.id", "role.user_id")
    .innerJoin("patient_doctor_assignments as pda", "users.id", "pda.doctor_id")
    .where("role.role_type", "clinician")
    .andWhere("pda.patient_id", patientId)
    .andWhere("users.is_active", true);
  if (active.length) return { recipients: active, escalated: false };

  const patient = await db("users").select("organization_id").where("id", patientId).first();
  if (patient && patient.organization_id != null) {
    const admins = await db("users")
      .select("users.id", "users.name", "users.email", "users.phoneNumber", "users.organization_id")
      .innerJoin("role", "users.id", "role.user_id")
      .whereIn("role.role_type", ["admin", "super-admin"])
      .andWhere("users.organization_id", patient.organization_id)
      .andWhere("users.is_active", true);
    if (admins.length) return { recipients: admins, escalated: true };
  }
  return { recipients: [], escalated: true };
}

async function orgNameFor(userId) {
  try {
    const row = await db("users")
      .leftJoin("organizations", "users.organization_id", "organizations.id")
      .select("organizations.name as org_name")
      .where("users.id", userId).first();
    return (row && row.org_name) || "your clinic";
  } catch {
    return "your clinic";
  }
}

function buildContent(orgName) {
  // NO PHI — no message body, no patient name or id. Deep link only.
  const text = `New patient message in ${orgName} RPM. Sign in to read and reply: ${DEEP_LINK}`;
  const html = `<p>You have a new patient message in <b>${orgName} RPM</b>.</p>` +
               `<p><a href="${DEEP_LINK}">Sign in to the dashboard</a> to read and reply.</p>`;
  return { subject: "New patient message", text, html };
}

async function recentlyNotified(patientId, recipientId) {
  const since = new Date(Date.now() - DEBOUNCE_MINUTES * 60 * 1000);
  const row = await db("notification_deliveries")
    .where({ patient_id: patientId, recipient_user_id: recipientId })
    .whereIn("status", ["sent", "accepted", "delivered"])
    .andWhere("created_at", ">=", since)
    .first();
  return !!row;
}

async function sendSmsWithRetry(to, message) {
  const opts = { statusCallback: SMS_STATUS_CALLBACK };
  let res = await twilioService.sendSMS(to, message, opts);
  const permanent = res && res.code && PERMANENT_SMS_CODES.includes(res.code);
  if (res && res.success === false && !permanent) {
    res = await twilioService.sendSMS(to, message, opts); // one retry for a transient failure
    if (res) res.attempts = 2;
  }
  return res;
}

// Fire-and-forget entry point from messageController.sendMessage.
async function notifyOnPatientMessage(senderId, receiverId) {
  try {
    const senderRole = await db("role").select("role_type").where("user_id", senderId).first();
    if (!senderRole || senderRole.role_type !== "patient") return; // only patient -> clinician

    const patientId = senderId;
    const { recipients } = await resolveRecipients(patientId);

    if (recipients.length === 0) {
      await recordDelivery({
        patientId, channel: "none", status: "unroutable",
        error: "No active assigned physician and no org admin — orphaned assignment (ORG_CONTEXT_FOLLOWUPS #6)",
      });
      console.error(`notification: UNROUTABLE patient message from ${patientId} — nobody to notify`);
      return;
    }

    const orgName = await orgNameFor(patientId);
    const { subject, text, html } = buildContent(orgName);

    for (const r of recipients) {
      if (await recentlyNotified(patientId, r.id)) {
        await recordDelivery({ patientId, recipientUserId: r.id, channel: "any", status: "skipped",
          providerStatus: `debounced ${DEBOUNCE_MINUTES}m` });
        continue;
      }
      const prefs = await getPrefs(r.id);

      if (prefs.message_email && r.email) {
        const er = await sendNotificationEmail(r.email, subject, html, text);
        await recordDelivery({ patientId, recipientUserId: r.id, channel: "email",
          status: er && er.success ? "sent" : "failed",
          providerStatus: er && er.success ? "accepted" : null,
          error: er && er.success ? null : (er && er.error) || "email send failed" });
      }

      if (prefs.message_sms && r.phoneNumber) {
        const sr = await sendSmsWithRetry(r.phoneNumber, text);
        await recordDelivery({ patientId, recipientUserId: r.id, channel: "sms",
          status: sr && sr.success ? "accepted" : "failed",
          providerRef: sr && (sr.sid || sr.messageId) ? sr.sid || sr.messageId : null,
          providerStatus: sr ? sr.status || null : null,
          attempts: sr && sr.attempts ? sr.attempts : 1,
          error: sr && sr.success ? null : (sr && sr.error) || "sms send failed" });
      }
    }
  } catch (e) {
    console.error("notification: notifyOnPatientMessage error:", e.message);
    try { await recordDelivery({ channel: "none", status: "failed", error: e.message }); } catch (_) {}
  }
}

module.exports = {
  notifyOnPatientMessage,
  updateDeliveryByProviderRef,
  getPrefs,
  setPrefs,
  getRecentFailures,
  getFailureCount,
};
