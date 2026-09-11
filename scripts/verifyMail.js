// scripts/verifyMail.js
//
// Definitive prod SMTP check — run this BEFORE enabling the clinician digest, so a scheduler
// is never pointed at a dead transport (the recurring silent-failure this project keeps
// producing). Two levels:
//   node scripts/verifyMail.js                 -> transporter.verify() only (connect + auth)
//   node scripts/verifyMail.js you@example.com -> verify AND send a real test digest email
// A Gmail app password can silently expire, so verify() (no send) is the fast credential
// check; the optional send proves end-to-end delivery to an inbox you control.
require("dotenv").config();
const { verifyTransport, sendDigestEmail } = require("../services/mail.service");

(async () => {
  try {
    await verifyTransport();
    console.log("✅ SMTP OK — transporter.verify() succeeded (Gmail connect + auth).");
  } catch (e) {
    console.error("❌ SMTP verify() FAILED:", e.message);
    console.error("   The digest transport is broken — do NOT enable the digest scheduler.");
    process.exit(1);
  }

  const to = process.argv[2];
  if (!to) {
    console.log("ℹ️  To also send a real test email: node scripts/verifyMail.js you@example.com");
    process.exit(0);
  }
  try {
    await sendDigestEmail(to, {
      periodLabel: "weekly",
      loginUrl: process.env.DIGEST_LOGIN_URL || "https://api.twentytwohealth.com",
    });
    console.log(`✅ Test digest email sent to ${to} — confirm it arrives (check spam too).`);
    process.exit(0);
  } catch (e) {
    console.error("❌ Test send FAILED:", e.message);
    process.exit(1);
  }
})();
