// controllers/notification.controller.js
//
// Twilio webhooks (inbound STOP/START/HELP + delivery status), the staff-facing
// health/failures endpoints, and the per-patient comm prefs + toggles.
const db = require("../config/db");
const notif = require("../services/notification.service");
const audit = require("../services/audit.service");
const {
  HELP_BODY,
  SMS_CLINICAL_CONSENT_VERSION,
  SMS_CLINICAL_CONSENT_METHODS,
} = require("../config/notifications");

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
      const [[u]] = [
        await db.query(
          `SELECT u.organization_id, o.name AS org_name
             FROM users u LEFT JOIN organizations o ON o.id = u.organization_id
            WHERE u.id = ?`,
          [patientId]
        ),
      ];
      const orgId = u[0] ? u[0].organization_id : null;
      if (STOP_WORDS.has(body)) {
        await notif.setOptOut({ patientId, source: "stop_keyword" });
      } else if (START_WORDS.has(body)) {
        await notif.clearOptOut({ patientId, source: "start_keyword" });
      } else if (HELP_WORDS.has(body)) {
        reply = HELP_BODY({ clinicName: (u[0] && u[0].org_name) || "Your clinic" });
      } else {
        // A real reply — store it so a clinician can see it. Previously DROPPED:
        // the webhook received every message, handled the keywords, and silently
        // discarded the rest (SECURITY_FOLLOWUPS — patient texting into silence).
        // Store the ORIGINAL text (req.body.Body), not the lowercased keyword copy.
        await notif.recordInboundReply({
          patientId,
          organizationId: orgId,
          from,
          body: String(req.body.Body || "").trim(),
        });
      }
    }
    // else: unknown number (not an enrolled patient) — nothing to attach it to;
    // notification_log.patient_id is NOT NULL. Logged and dropped (rare: the clinic
    // number only texts enrolled patients). See SECURITY_FOLLOWUPS for the catch-table option.
    if (!patientId) {
      console.warn("smsInbound: reply from unmatched number", from);
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

// GET /api/patients/:patientId/clinical-sms-consent — read the clinical-SMS consent
// state (separate from reminder sms_consent and from RPM consent). staffRoles may VIEW.
async function getClinicalSmsConsent(req, res) {
  try {
    const patientId = Number(req.params.patientId);
    const prefs = await notif.getPrefs(patientId);

    // Tell the UI what the CURRENT ACTOR may do, computed by the same authoritative
    // helpers the write paths gate on — so the dashboard never has to infer capability
    // from a (fragile) client-side JWT role. Reused, not duplicated:
    //   can_attest_consent   = actorHoldsClinicalRole (active clinician OR care_manager)
    //                          — also the actor set allowed to SET the hard-disable.
    //   can_clear_hard_disable = actorIsActiveClinician (active clinician ONLY).
    const canAttest = await notif.actorHoldsClinicalRole(req.user.id);
    const canClearHardDisable = await notif.actorIsActiveClinician(req.user.id);

    return res.status(200).json({
      ok: true,
      sms_clinical_consent: !!(prefs && prefs.sms_clinical_consent),
      sms_clinical_consent_at: prefs ? prefs.sms_clinical_consent_at : null,
      sms_clinical_consent_by: prefs ? prefs.sms_clinical_consent_by : null,
      sms_clinical_consent_version: prefs ? prefs.sms_clinical_consent_version : null,
      consent_method: prefs ? prefs.consent_method : null,
      // The SUD/Part 2 hard-disable state (neutral boolean; reason never stored).
      sms_clinical_hard_disabled: !!(prefs && prefs.sms_clinical_hard_disabled),
      sms_clinical_hard_disabled_at: prefs ? prefs.sms_clinical_hard_disabled_at : null,
      sms_clinical_hard_disabled_by: prefs ? prefs.sms_clinical_hard_disabled_by : null,
      // The wording version a NEW record would be stamped with, for the UI to show.
      current_version: SMS_CLINICAL_CONSENT_VERSION,
      // Actor capability (authoritative) — the UI shows/hides controls from these.
      can_attest_consent: canAttest,
      can_set_hard_disable: canAttest,
      can_clear_hard_disable: canClearHardDisable,
      // Whether the outbound SMS send path is enabled at all (flag). When false the UI
      // must not offer the SMS modes — they would always fail feature_disabled.
      sms_clinical_enabled: notif.SMS_CLINICAL_ENABLED,
    });
  } catch (err) {
    console.error("getClinicalSmsConsent error:", err.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// POST /api/patients/:patientId/clinical-sms-consent — record/revoke the SEPARATE
// clinical-SMS consent. Body: { consent: bool }. Staff records it on the patient's
// behalf. ATTESTATION requires an actual clinical role: a management-only admin/
// super-admin passes the coarse staffRoles route gate but is refused here, so a
// non-clinician cannot attest. The wording version is stamped server-side; every
// record is audited (actor + timestamp come from the audit row; version in metadata;
// no PHI).
async function recordClinicalSmsConsent(req, res) {
  try {
    const patientId = Number(req.params.patientId);
    const b = req.body || {};
    const consent = b.consent === true;
    const method = b.consent_method;

    const isClinical = await notif.actorHoldsClinicalRole(req.user.id);
    if (!isClinical) {
      return res.status(403).json({
        ok: false,
        message:
          "Recording clinical-SMS consent requires a clinical role (clinician or care manager).",
      });
    }

    // consent_method is REQUIRED when granting (coded enum, never free text). Not needed
    // on revoke.
    if (consent && !SMS_CLINICAL_CONSENT_METHODS.includes(method)) {
      return res.status(400).json({
        ok: false,
        message:
          "consent_method is required when granting consent and must be one of: " +
          SMS_CLINICAL_CONSENT_METHODS.join(", ") + ".",
      });
    }

    await notif.setClinicalConsent({
      patientId,
      consent,
      version: SMS_CLINICAL_CONSENT_VERSION,
      method: consent ? method : null,
      actorId: req.user.id,
    });

    await audit.record({
      req,
      action: audit.ACTIONS.SMS_CLINICAL_CONSENT_RECORDED,
      entityType: "patient",
      entityId: patientId,
      organizationId: req.orgScope,
      // Explicit grant/revoke discriminator so the two are distinguishable without
      // inferring from the bool. method is a CODED value (not PHI). NO name — patient is
      // entityId, not metadata.
      metadata: {
        event: consent ? "grant" : "revoke",
        consent,
        version: SMS_CLINICAL_CONSENT_VERSION,
        ...(consent ? { method } : {}),
      },
    });

    return res.status(200).json({
      ok: true,
      sms_clinical_consent: consent,
      sms_clinical_consent_version: consent ? SMS_CLINICAL_CONSENT_VERSION : null,
      consent_method: consent ? method : null,
    });
  } catch (err) {
    console.error("recordClinicalSmsConsent error:", err.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// POST /api/patients/:patientId/clinical-sms-hard-disable — set/clear the SUD/Part 2
// per-patient hard-disable of free-text clinical SMS. Body: { disabled: bool }.
// ASYMMETRIC permissions (deliberate): SET is an active clinician OR care_manager;
// CLEAR is an active CLINICIAN ONLY (a care_manager can raise the safety flag but not
// lift it). The reason is NEVER stored — neutral boolean only. Audited, no PHI.
async function setClinicalHardDisable(req, res) {
  try {
    const patientId = Number(req.params.patientId);
    const disabled = (req.body || {}).disabled === true;

    if (disabled) {
      const allowed = await notif.actorHoldsClinicalRole(req.user.id);
      if (!allowed) {
        return res.status(403).json({
          ok: false,
          message:
            "Setting the clinical-SMS hard-disable requires a clinical role (clinician or care manager).",
        });
      }
    } else {
      const allowed = await notif.actorIsActiveClinician(req.user.id);
      if (!allowed) {
        return res.status(403).json({
          ok: false,
          message: "Clearing the clinical-SMS hard-disable requires a clinician.",
        });
      }
    }

    await notif.setClinicalHardDisable({ patientId, disabled, actorId: req.user.id });

    await audit.record({
      req,
      action: audit.ACTIONS.SMS_CLINICAL_HARD_DISABLE_CHANGED,
      entityType: "patient",
      entityId: patientId,
      organizationId: req.orgScope,
      // disable/enable discriminator. NO PHI, no reason, no name — patient is entityId.
      metadata: { event: disabled ? "disable" : "enable" },
    });

    return res.status(200).json({ ok: true, sms_clinical_hard_disabled: disabled });
  } catch (err) {
    console.error("setClinicalHardDisable error:", err.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// POST /api/patients/:patientId/notifications/send — fire an existing template
// NOW. Body: { type, force }. Returns the outcome so the UI can react:
//   sent | compliant (patient is current; re-send with force) |
//   skipped (no_consent | opted_out) | failed.
async function sendNow(req, res) {
  try {
    const patientId = Number(req.params.patientId);
    const { type, force } = req.body || {};
    const result = await notif.sendOnDemand({
      patientId,
      type,
      force: force === true,
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    if (err && err.httpStatus)
      return res.status(err.httpStatus).json({ ok: false, message: err.message });
    console.error("sendNow error:", err.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// GET /api/patients/:patientId/notifications — the patient's notification log.
async function getPatientNotificationLog(req, res) {
  try {
    const log = await notif.getPatientLog(Number(req.params.patientId));
    return res.status(200).json({ ok: true, log });
  } catch (err) {
    console.error("getPatientNotificationLog error:", err.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// POST /api/patients/:patientId/notifications/ack — mark this patient's inbound
// replies seen (clears the "reply waiting" signal on the patient list).
async function acknowledgeInbound(req, res) {
  try {
    const cleared = await notif.acknowledgeInbound({
      patientId: Number(req.params.patientId),
      actorId: req.user.id,
    });
    return res.status(200).json({ ok: true, cleared });
  } catch (err) {
    console.error("acknowledgeInbound error:", err.message);
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
  getClinicalSmsConsent,
  recordClinicalSmsConsent,
  setClinicalHardDisable,
  sendNow,
  getPatientNotificationLog,
  acknowledgeInbound,
};
