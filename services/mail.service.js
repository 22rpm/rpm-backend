// services/mail.service.js
const nodemailer = require("nodemailer");
const { getOtpEmailTemplate, getDigestEmailTemplate } = require("../helper/mailTemplate");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER, // your gmail address
    pass: process.env.GMAIL_PASS, // app password (not your real password)
  },
});

async function sendOtpEmail(to, otp) {
  // REDACTED: never log the OTP — it's a live auth credential. Anyone with log
  // access could complete a login during the OTP window. See SECURITY_FOLLOWUPS.

  await transporter.sendMail({
    from: `"TwentyTwo RPM" <${process.env.GMAIL_USER}>`,
    to,
    subject: "Your OTP Code",
    text: `Your OTP code is: ${otp}`,
    // html: `<p>Your OTP code is: <b>${otp}</b></p>`,
    html: getOtpEmailTemplate(otp),
  });
}

// Password-reset code email. Distinct wording from the login OTP so the recipient knows this
// is a reset (and can ignore it if they didn't ask). Same proven transporter. Never log the code.
async function sendPasswordResetEmail(to, code, { expiresMinutes = 15 } = {}) {
  await transporter.sendMail({
    from: `"TwentyTwo RPM" <${process.env.GMAIL_USER}>`,
    to,
    subject: "Your password reset code",
    text:
      `Someone requested a password reset for your TwentyTwo RPM account.\n\n` +
      `Your reset code is: ${code}\n\n` +
      `It expires in ${expiresMinutes} minutes and can be used once. ` +
      `If you did not request this, you can ignore this email — your password will not change.`,
    html:
      `<p>Someone requested a password reset for your TwentyTwo RPM account.</p>` +
      `<p style="font-size:20px"><b>${code}</b></p>` +
      `<p>It expires in ${expiresMinutes} minutes and can be used once. ` +
      `If you did not request this, you can ignore this email — your password will not change.</p>`,
  });
}

// Verify SMTP connectivity + auth WITHOUT sending — resolves on success, throws otherwise.
// Used by scripts/verifyMail.js (a definitive prod check) and by the digest scheduler at
// startup so a broken transport is surfaced loudly, not discovered as a silent no-send.
async function verifyTransport() {
  return transporter.verify();
}

// Clinician overview digest nudge — NO PHI (see getDigestEmailTemplate). Throws on failure so
// the caller can count it as an error, never swallow it.
async function sendDigestEmail(to, { periodLabel, loginUrl }) {
  await transporter.sendMail({
    from: `"TwentyTwo RPM" <${process.env.GMAIL_USER}>`,
    to,
    subject: `Your ${periodLabel} patient overview is ready`,
    text: `Your ${periodLabel} patient overview is ready. Log in to review it: ${loginUrl}`,
    html: getDigestEmailTemplate({ periodLabel, loginUrl }),
  });
}

module.exports = { sendOtpEmail, sendPasswordResetEmail, sendDigestEmail, verifyTransport };

// services/mail.service.js
// const nodemailer = require("nodemailer");

// const transporter = nodemailer.createTransport({
//   host: "sandbox.smtp.mailtrap.io",
//   port: 587,
//   auth: {
//     user: process.env.MAILTRAP_USER, // add to .env
//     pass: process.env.MAILTRAP_PASS, // add to .env
//   },
// });

// async function sendOtpEmail(to, otp) {
//   await transporter.sendMail({
//     from: '"Your App" <noreply@yourapp.com>',
//     to,
//     subject: "Your OTP Code",
//     text: `Your OTP code is: ${otp}`,
//     html: `<p>Your OTP code is: <b>${otp}</b></p>`,
//   });
// }

// module.exports = { sendOtpEmail };
