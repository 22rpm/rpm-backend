// controllers/passwordReset.controller.js
//
// Password recovery endpoints (PASSWORD_RECOVERY_DESIGN.md). Self-service request/confirm are PUBLIC
// (the user is locked out) and anti-enumeration; the admin-initiated send is gated on the route.
const svc = require("../services/passwordReset.service");

// Same generic message whether or not the account exists — the response must not reveal it.
// Channel-agnostic (phone or email) so it doesn't leak which contact is on file.
const GENERIC_REQUEST_MSG =
  "If an account matches, a password reset code has been sent to the phone or email on file.";

// POST /api/auth/password-reset/request  { identifier }
async function requestReset(req, res) {
  try {
    const identifier = (req.body && req.body.identifier) || "";
    await svc.requestSelfService({ identifier, req });
  } catch (err) {
    // Swallow to the generic response — a differing error would leak account existence.
    console.error("requestReset error:", err?.message);
  }
  return res.status(200).json({ ok: true, message: GENERIC_REQUEST_MSG });
}

// POST /api/auth/password-reset/confirm  { identifier, code, new_password }
async function confirmReset(req, res) {
  try {
    const b = req.body || {};
    const result = await svc.confirmReset({
      identifier: b.identifier,
      code: b.code,
      newPassword: b.new_password ?? b.newPassword,
      req,
    });
    if (result.ok) {
      return res.status(200).json({ ok: true, message: "Your password has been reset. You can now sign in." });
    }
    if (result.reason === "weak_password") {
      return res
        .status(400)
        .json({ ok: false, message: `Password must be at least ${svc.MIN_PASSWORD_LEN} characters.` });
    }
    if (result.reason === "rate_limited") {
      return res
        .status(429)
        .json({ ok: false, message: "Too many attempts. Please request a new code and try again shortly." });
    }
    // invalid / expired — generic, never says which of identifier/code was wrong.
    return res.status(400).json({ ok: false, message: "Invalid or expired code." });
  } catch (err) {
    console.error("confirmReset error:", err?.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// POST /api/admin/users/:userId/send-password-reset  (admin-only; route gates + org-scopes)
// Explicit result (the admin picked the patient and needs to know what happened).
async function adminSendReset(req, res) {
  try {
    const userId = Number(req.params.userId);
    const result = await svc.adminSendReset({
      userId,
      actor: { id: req.user.id, role: req.user.role_type || req.user.role },
      req,
    });
    if (result.sent) {
      const where = result.channel === "sms" ? "texted to the patient's phone" : "emailed to the patient";
      return res.status(200).json({ ok: true, channel: result.channel, message: `A password reset code has been ${where}.` });
    }
    if (result.reason === "no_contact") {
      // Loud, explicit — staff must reset manually (no phone or email to send a code to).
      return res.status(400).json({
        ok: false,
        reason: "no_contact",
        message:
          "This patient has no phone or email on file — a reset code can't be sent. Add a phone or email, or reset the password manually via Edit User.",
      });
    }
    if (result.reason === "send_failed") {
      return res
        .status(502)
        .json({ ok: false, message: "Could not deliver the reset code (SMS/email send failed). Try again." });
    }
    if (result.reason === "rate_limited") {
      return res
        .status(429)
        .json({ ok: false, message: "A reset code was sent to this patient recently. Try again shortly." });
    }
    if (result.reason === "no_user") {
      return res.status(404).json({ ok: false, message: "Patient not found." });
    }
    return res.status(500).json({ ok: false, message: "Could not send a reset code." });
  } catch (err) {
    console.error("adminSendReset error:", err?.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

module.exports = { requestReset, confirmReset, adminSendReset };
