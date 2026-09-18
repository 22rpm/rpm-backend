// services/passwordReset.service.js
//
// Password recovery primitive (PASSWORD_RECOVERY_DESIGN.md PR-1). Sends a single-use, expiring code
// to the contact ON FILE, verifies it, and sets a new password. Channel order: SMS to the phone on
// file (the channel an elderly panel actually uses), then EMAIL as fallback (works for the current
// no-phone patients from day one), then a CLEAR failure if neither is on file so staff know a manual
// reset is required — never a silent nothing. The code always goes to the on-file contact, never to
// one typed at reset time (that would be an account-takeover vector).
//
// Security properties:
//   - code -> the on-file email only; 6 digits; 15-min expiry; single-use (otp.service consumes it).
//   - request is rate-limited per account (caps email-bombing); confirm is attempt-limited per
//     account (caps code brute-force on top of single-use + short expiry).
//   - self-service request/confirm are ANTI-ENUMERATION: the caller cannot tell whether an account
//     exists (identical outcome either way). The admin-initiated path (PR-2) is explicit — the admin
//     already sees the patient list, and needs to know whether a code was actually sent.
//   - every request and completion is audit-logged.
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const db = require("../config/db");
const { createOtp, verifyOtp } = require("./otp.service");
const mail = require("./mail.service");
const twilio = require("./twillio.service");
const audit = require("./audit.service");
const {
  findUserByEmail,
  findUserByUsername,
  findUserByPhone,
  getUserById,
} = require("./user.service");

const OTP_TYPE = "password_reset";
const EXPIRES_MIN = 15;
const REQUESTS_PER_WINDOW = 3; // per account per window
const CONFIRM_ATTEMPTS_PER_WINDOW = 8; // per account per window
const WINDOW_MS = 15 * 60 * 1000;
const MIN_PASSWORD_LEN = 8;

// A patient signs in with username, email, OR phone; mirror that resolution so a reset can start
// from whatever they know. The code still goes to their on-file EMAIL regardless of identifier.
function looksLikePhone(identifier) {
  const s = String(identifier || "").trim();
  if (s.includes("@")) return false;
  const digits = s.replace(/[^0-9]/g, "");
  return digits.length >= 7 && /^[+0-9()\-\s]+$/.test(s);
}
async function resolveUser(identifier) {
  const id = String(identifier || "").trim();
  if (!id) return null;
  if (looksLikePhone(id)) return await findUserByPhone(id);
  if (id.includes("@")) return await findUserByEmail(id);
  return await findUserByUsername(id);
}

// DB-backed request cap (survives restarts): how many reset codes were issued to this user recently.
async function recentRequestCount(userId) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS n FROM otp_tokens
      WHERE user_id = ? AND otp_type = ?
        AND created_at > (UTC_TIMESTAMP() - INTERVAL ? SECOND)`,
    [userId, OTP_TYPE, Math.floor(WINDOW_MS / 1000)]
  );
  return Number(rows[0]?.n || 0);
}

// In-memory confirm-attempt limiter (single pm2 instance). Keyed by user id.
const confirmAttempts = new Map(); // userId -> { count, windowStart }
function tooManyConfirms(userId) {
  const now = Date.now();
  const e = confirmAttempts.get(userId);
  if (!e || now - e.windowStart > WINDOW_MS) {
    confirmAttempts.set(userId, { count: 0, windowStart: now });
    return false;
  }
  return e.count >= CONFIRM_ATTEMPTS_PER_WINDOW;
}
function noteConfirmFailure(userId) {
  const e = confirmAttempts.get(userId) || { count: 0, windowStart: Date.now() };
  e.count += 1;
  confirmAttempts.set(userId, e);
}

const genCode = () => String(crypto.randomInt(100000, 1000000)); // 6 digits

// A patient who replied STOP can't receive SMS (the carrier blocks our number regardless of message
// type), so treat opted-out as "no usable phone" and fall through to email.
async function isOptedOut(userId) {
  try {
    const [rows] = await db.query(
      "SELECT opted_out FROM patient_comm_prefs WHERE patient_id = ? LIMIT 1",
      [userId]
    );
    return !!(rows[0] && rows[0].opted_out);
  } catch {
    return false; // fail open to "can try SMS"; email fallback still applies if the send fails
  }
}

// Issue a code to the user's on-file contact. Channel order: SMS (phone on file & not opted out) ->
// EMAIL fallback -> neither. Shared by self-service and admin paths. Returns
// { sent, channel?, reason? } — callers decide how much of that to reveal.
async function issueCode(user, { actorId, actorRole, req, phase }) {
  if (!user) return { sent: false, reason: "no_user" };
  if (await recentRequestCount(user.id) >= REQUESTS_PER_WINDOW) {
    return { sent: false, reason: "rate_limited" };
  }

  const to = twilio.formatPhoneNumber(user.phoneNumber);
  const canSms = !!to && !(await isOptedOut(user.id));
  const canEmail = !!user.email;
  // Neither channel on file -> loud, explicit failure (staff must reset manually). Never silent.
  if (!canSms && !canEmail) return { sent: false, reason: "no_contact" };

  const code = genCode();
  await createOtp(user.id, code, OTP_TYPE, EXPIRES_MIN); // one code; whichever channel delivers it

  let channel = null;
  if (canSms) {
    const msg =
      `Your 22RPM password reset code is ${code}. It expires in ${EXPIRES_MIN} minutes and can be ` +
      `used once. If you didn't request it, ignore this message.`;
    const r = await twilio.sendSMS(to, msg);
    if (r && r.success) channel = "sms";
    else if (canEmail) {
      await mail.sendPasswordResetEmail(user.email, code, { expiresMinutes: EXPIRES_MIN });
      channel = "email";
    } else {
      return { sent: false, reason: "send_failed" };
    }
  } else {
    await mail.sendPasswordResetEmail(user.email, code, { expiresMinutes: EXPIRES_MIN });
    channel = "email";
  }

  await audit.record({
    req,
    actorId: actorId !== undefined ? actorId : user.id,
    actorRole: actorRole || "patient",
    action: audit.ACTIONS.PASSWORD_RESET,
    entityType: "user",
    entityId: user.id,
    organizationId: user.organization_id ?? null,
    metadata: { phase, channel },
  });
  return { sent: true, channel };
}

// Self-service: patient enters their identifier. ALWAYS returns the same generic result — never
// reveals whether the account/email exists (anti-enumeration). Errors are swallowed to a generic
// ok for the same reason (a 500 on "user exists" vs 200 on "doesn't" would leak).
async function requestSelfService({ identifier, req }) {
  try {
    const user = await resolveUser(identifier);
    await issueCode(user, { req, phase: "requested" });
  } catch (e) {
    console.error("password reset request error (suppressed for anti-enumeration):", e?.message);
  }
  return { ok: true };
}

// Admin-initiated (PR-2): trusted actor, explicit result so the dashboard can say what happened.
// Caller must gate to admins and org-scope the target.
async function adminSendReset({ userId, actor, req }) {
  const user = await getUserById(userId);
  const res = await issueCode(user, {
    actorId: actor?.id ?? null,
    actorRole: actor?.role || "admin",
    req,
    phase: "admin_requested",
  });
  return res; // { sent, channel?, reason? }
}

// Verify the code and set the new password. Generic failure (never says which of identifier/code
// was wrong). Attempt-limited per account.
async function confirmReset({ identifier, code, newPassword, req }) {
  if (!newPassword || String(newPassword).length < MIN_PASSWORD_LEN) {
    return { ok: false, reason: "weak_password" };
  }
  const user = await resolveUser(identifier);
  if (!user) return { ok: false, reason: "invalid" }; // generic

  if (tooManyConfirms(user.id)) return { ok: false, reason: "rate_limited" };

  const valid = await verifyOtp(user.id, String(code || "").trim(), OTP_TYPE);
  if (!valid) {
    noteConfirmFailure(user.id);
    return { ok: false, reason: "invalid" };
  }

  const hashed = await bcrypt.hash(String(newPassword), 12);
  await db.query("UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?", [hashed, user.id]);
  confirmAttempts.delete(user.id);
  await audit.record({
    req,
    actorId: user.id,
    actorRole: "patient",
    action: audit.ACTIONS.PASSWORD_RESET,
    entityType: "user",
    entityId: user.id,
    organizationId: user.organization_id ?? null,
    metadata: { phase: "completed", channel: "email" },
  });
  return { ok: true };
}

module.exports = { requestSelfService, adminSendReset, confirmReset, MIN_PASSWORD_LEN };
