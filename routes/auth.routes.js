// routes/auth.routes.js
const express = require("express");
const {
  login,
  me,
  logout,
  register,
  verifyOtpController,
  refresh
} = require("../controllers/auth.controller");
const { authRequired } = require("../middleware/auth");
const { addDevData } = require("../controllers/auth.controller");

const router = express.Router();

router.post("/refresh-token", refresh );
router.post("/login", login);
router.get("/check-me", authRequired, me);
router.post("/logout", authRequired, logout);
router.post("/register", register);
router.post("/verify-otp", verifyOtpController);
router.post("/", addDevData);
// router.post('/mfa/setup', mfaSetup);    // returns secret/QR using the challengeToken
// router.post('/mfa/verify', mfaVerify);  // verifies TOTP and sets the auth cookie

module.exports = router;
