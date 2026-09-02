// controllers/notification.controller.js
//
// Twilio webhooks (inbound STOP/START/HELP + delivery status), the staff-facing
// health/failures endpoints, and the per-patient comm prefs + toggles.
const db = require("../config/db");
const notif = require("../services/notification.service");
const { HELP_BODY } = require("../config/notifications");

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const START_WORDS = new Set(["start", "yes", "unstop"]);
const HELP_WORDS = new Set(["help", "info"]);

// Find a patient by the inbound From number — match on the last 10 digits so
// formatting differences (+1, dashes) don't cause a miss.
async function findPatientByPhone(from) {
  const digits = String(from || "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  const [rows] = await db.query(
    `SELECT u.id FROM users u
       JOIN role r ON r.user_id = u.id AND r.role_type = 'patient'
      WHERE u.phoneNumber LIKE ? LIMIT 1`,
    [`%${last10}`]
  );
  return rows[0] ? rows[0].id : null;
}

// POST /api/notifications/sms-inbound — STOP/START/HELP. Twilio-signature verified
// by middleware. Recording an opt-out here is one of THREE layers (see the service);
// even if this webhook is never received, a later send's 21610 self-heals it.
async function smsInbound(req, res) {
  try {
    const body = String(req.body.Body || "").trim().toLowerCase();
    const from = req.body.From;
    const patientId = await findPatientByPhone(from);

    let reply = "";
    if (patientId) {
      if (STOP_WORDS.has(body)) {
        await notif.setOptOut({ patientId, source: "stop_keyword" });
      } else if (START_WORDS.has(body)) {
        await notif.clearOptOut({ patientId, source: "start_keyword" });
      } else if (HELP_WORDS.has(body)) {
        const [[org]] = [
          await db.query(
            `SELECT o.name FROM users u LEFT JOIN organizations o ON o.id = u.organization_id WHERE u.id = ?`,
            [patientId]
          ),
        ];
        reply = HELP_BODY({ clinicName: (org && org.name) || "Your clinic" });
      }
    }
    // TwiML response (empty, or a HELP reply). Twilio also applies its own default
    // STOP/HELP handling regardless.
    res.set("Content-Type", "text/xml");
    return res
      .status(200)
      .send(
        reply
          ? `<Response><Message>${escapeXml(reply)}</Message></Response>`
          : "<Response></Response>"
      );
  } catch (err) {
    console.error("smsInbound error:", err.message);
    res.set("Content-Type", "text/xml");
    return res.status(200).send("<Response></Response>");
  }
}

// POST /api/notifications/sms-status — Twilio delivery status callback.
async function smsStatus(req, res) {
  try {
    await notif.recordDeliveryStatus({
      sid: req.body.MessageSid || req.body.SmsSid,
      messageStatus: req.body.MessageStatus || req.body.SmsStatus,
      errorCode: req.body.ErrorCode || null,
    });
  } catch (err) {
    console.error("smsStatus error:", err.message);
  }
  return res.status(204).end();
}

// GET /api/notifications/health — org-scoped rollup (systemic outage + repeated
// unintended skips). Staff-gated by route middleware.
async function getHealth(req, res) {
  try {
    const health = await notif.getHealth({ orgScope: req.orgScope });
    return res.status(200).json({ ok: true, health });
  } catch (err) {
    console.error("notif getHealth error:", err.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// GET /api/notifications/failures — recent failed/undelivered sends.
async function getFailures(req, res) {
  try {
    const failures = await notif.getFailures({ orgScope: req.orgScope, limit: 50 });
    return res.status(200).json({ ok: true, failures });
  } catch (err) {
    console.error("notif getFailures error:", err.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// GET /api/patients/:patientId/comm-prefs — consent + toggles for a patient.
async function getPatientComms(req, res) {
  try {
    const patientId = Number(req.params.patientId);
    const prefs = await notif.getPrefs(patientId);
    const settings = await notif.getSettings(patientId);
    return res.status(200).json({
      ok: true,
      sms_consent: !!(prefs && prefs.sms_consent),
      opted_out: !!(prefs && prefs.opted_out),
      opted_out_source: prefs ? prefs.opted_out_source : null,
      settings, // [{type, enabled, cadence_days}]
    });
  } catch (err) {
    console.error("getPatientComms error:", err.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// PUT /api/patients/:patientId/comm-prefs — set consent + toggles.
// Body: { sms_consent: bool, settings: [{type, enabled, cadence_days}] }.
// A type cannot be enabled without SMS consent on file (or being set in the same
// request) — consent is the prerequisite, enforced here.
async function setPatientComms(req, res) {
  try {
    const patientId = Number(req.params.patientId);
    const b = req.body || {};
    const consent = b.sms_consent === true;
    const settings = Array.isArray(b.settings) ? b.settings : [];

    const enablingAny = settings.some((s) => s.enabled === true);
    if (enablingAny && !consent) {
      return res.status(400).json({
        ok: false,
        message: "SMS consent is required before enabling any automated notifications.",
      });
    }

    await notif.setConsent({ patientId, consent, actorId: req.user.id });
    for (const s of settings) {
      await notif.upsertSetting({
        patientId,
        type: s.type,
        enabled: s.enabled === true,
        cadenceDays: s.cadence_days != null ? Number(s.cadence_days) : null,
        actorId: req.user.id,
      });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err && err.httpStatus)
      return res.status(err.httpStatus).json({ ok: false, message: err.message });
    console.error("setPatientComms error:", err.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c])
  );
}

module.exports = {
  smsInbound,
  smsStatus,
  getHealth,
  getFailures,
  getPatientComms,
  setPatientComms,
};
