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

module.exports = { sendOtpEmail, sendDigestEmail, verifyTransport };

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
