// services/mail.service.js
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "sandbox.smtp.mailtrap.io",
  port: 587,
  auth: {
    user: process.env.MAILTRAP_USER, // add to .env
    pass: process.env.MAILTRAP_PASS, // add to .env
  },
});

async function sendOtpEmail(to, otp) {
  await transporter.sendMail({
    from: '"Your App" <noreply@yourapp.com>',
    to,
    subject: "Your OTP Code",
    text: `Your OTP code is: ${otp}`,
    html: `<p>Your OTP code is: <b>${otp}</b></p>`,
  });
}

module.exports = { sendOtpEmail };
