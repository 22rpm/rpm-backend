const express = require("express");
const router = express.Router();
const { sendMfaOtp, verifyMfaOtp } = require("../services/mfa.service");

// Send OTP after login
router.post("/send-otp", async (req, res) => {
  try {
    const { userId, email, deviceId } = req.body;
    const result = await sendMfaOtp(userId, email, deviceId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

// Verify OTP
router.post("/verify-otp", async (req, res) => {
  try {
    const { userId, deviceId, otp } = req.body;
    const result = await verifyMfaOtp(userId, deviceId, otp);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

module.exports = router;
