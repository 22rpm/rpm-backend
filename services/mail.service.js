// services/mail.service.js
const nodemailer = require("nodemailer");
const { getOtpEmailTemplate } = require("../helper/mailTemplate");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER, // your gmail address
    pass: process.env.GMAIL_PASS, // app password (not your real password)
  },
});

async function sendOtpEmail(to, otp) {
  await transporter.sendMail({
    from: `"TwentyTwo RPM" <${process.env.GMAIL_USER}>`,
    to,
    subject: "Your OTP Code",
    text: `Your OTP code is: ${otp}`,
    // html: `<p>Your OTP code is: <b>${otp}</b></p>`,
    html: getOtpEmailTemplate(otp),
  });
}

module.exports = { sendOtpEmail };






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
