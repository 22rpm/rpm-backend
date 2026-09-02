// routes/notifications.routes.js
//
// Twilio webhooks (public but SIGNATURE-VERIFIED) + staff health/failures.
// Per-patient comm prefs live on patients.routes.js (they're patient-scoped and
// need canAccessPatient).
const express = require("express");
const router = express.Router();
const twilioLib = require("twilio");
const { authRequired, requireRole } = require("../middleware/auth");
const { resolveOrgScope } = require("../middleware/orgScope");
const {
  smsInbound,
  smsStatus,
  getHealth,
  getFailures,
} = require("../controllers/notification.controller");

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || null;

// Twilio webhooks POST application/x-www-form-urlencoded.
const twilioBody = express.urlencoded({ extended: false });

// Verify the X-Twilio-Signature so a forged request can't opt someone in/out or
// fake a delivery status. Bypass only with an explicit dev flag.
function verifyTwilioSignature(req, res, next) {
  if (process.env.NOTIF_SKIP_TWILIO_SIG === "true") return next();
  const token = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.get("X-Twilio-Signature");
  if (!token || !signature) return res.status(403).send("Forbidden");
  const url = PUBLIC_BASE_URL
    ? `${PUBLIC_BASE_URL.replace(/\/$/, "")}${req.originalUrl}`
    : `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  const valid = twilioLib.validateRequest(token, signature, url, req.body || {});
  if (!valid) return res.status(403).send("Forbidden");
  return next();
}

// Public (Twilio-called) webhooks.
router.post("/sms-inbound", twilioBody, verifyTwilioSignature, smsInbound);
router.post("/sms-status", twilioBody, verifyTwilioSignature, smsStatus);

// Staff: org-scoped health + failures.
const STAFF = requireRole("clinician", "admin", "super-admin", "care_manager");
router.get("/health", authRequired, STAFF, resolveOrgScope, getHealth);
router.get("/failures", authRequired, STAFF, resolveOrgScope, getFailures);

module.exports = router;
