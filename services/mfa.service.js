const crypto = require("crypto");
const transporter = require("../config/mail");
const knex = require("../config/knex"); // adjust path

async function sendMfaOtp(userId, email, deviceId) {
  const otp = ("" + Math.floor(100000 + Math.random() * 900000)).slice(-6); // 6-digit
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min expiry

  // Save OTP to user_devices
  await knex("user_devices")
    .where({ id: deviceId, user_id: userId })
    .update({
      mfa_enabled: true,
      mfa_otp: otp,
      mfa_expires_at: expiresAt,
      mfa_verified: false,
    });

  // Send OTP via Mailtrap
  await transporter.sendMail({
    from: '"TeleHealth Security" <security@telehealth.com>',
    to: email,
    subject: "Your MFA OTP Code",
    text: `Your OTP is: ${otp}. It will expire in 10 minutes.`,
  });

  return { message: "OTP sent to your email" };
}

async function verifyMfaOtp(userId, deviceId, otp) {
  const record = await knex("user_devices")
    .where({ id: deviceId, user_id: userId })
    .first();

  if (!record) throw new Error("Device not found");
  if (!record.mfa_enabled) throw new Error("MFA not enabled for this device");
  if (record.mfa_expires_at < new Date()) throw new Error("OTP expired");
  if (record.mfa_otp !== otp) throw new Error("Invalid OTP");

  await knex("user_devices")
    .where({ id: deviceId, user_id: userId })
    .update({
      mfa_verified: true,
      mfa_otp: null,
      mfa_expires_at: null,
    });

  return { message: "MFA verified successfully" };
}

module.exports = { sendMfaOtp, verifyMfaOtp };
