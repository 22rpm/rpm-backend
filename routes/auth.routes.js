// routes/auth.routes.js
const express = require("express");
const {
  login,
  me,
  logout,
  register,
  verifyOtpController,
  refresh,
} = require("../controllers/auth.controller");
const { authRequired, requireRole } = require("../middleware/auth");
const { ADMIN_ROLES } = require("../config/roles");
const { addDevData } = require("../controllers/auth.controller");

const router = express.Router();

router.post("/refresh-token", refresh);
router.post("/login", login);
router.get("/check-me", authRequired, me);
router.post("/logout", authRequired, logout);
// SECURITY: account creation is ADMIN-ONLY. Previously gated by authRequired alone, which
// let ANY authenticated session (a patient included) POST /register with role:"admin" and
// organization_id from their own token — minting a privileged account = privilege escalation.
// requireRole(...ADMIN_ROLES) restricts the route to admin/super-admin; the handler further
// caps WHICH role may be created (an admin cannot create admin/super-admin). (SECURITY_FOLLOWUPS #16)
router.post("/register", authRequired, requireRole(...ADMIN_ROLES), register);
router.post("/verify-otp", verifyOtpController);
router.post("/", addDevData);
// router.post('/mfa/setup', mfaSetup);    // returns secret/QR using the challengeToken
// router.post('/mfa/verify', mfaVerify);  // verifies TOTP and sets the auth cookie

module.exports = router;
