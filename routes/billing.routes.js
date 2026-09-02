// routes/billing.routes.js
//
// The biller surface (/api/billing). Read-only, minimum-necessary billing views
// gated to BILLING_READ_ROLES (biller + admin/super-admin oversight), plus
// super-admin-only biller management. The roster overview stays on
// /api/patients/billing-summary (shared with clinical staff).
const express = require("express");
const router = express.Router();
const { authRequired, requireRole } = require("../middleware/auth");
const { BILLING_READ_ROLES, SUPER_ADMIN_ONLY } = require("../config/roles");
const {
  getMyOrgs,
  listBillers,
  createBiller,
  setBillerOrgs,
} = require("../controllers/billing.controller");

// The caller's allowed clinics (biller clinic selector). No org scope — this is
// pre-selection (which clinics may I pick).
router.get("/my-orgs", authRequired, requireRole(...BILLING_READ_ROLES), getMyOrgs);

// NOTE: the reduced per-patient billing note/demographics endpoints were REMOVED
// in the reversal — a biller now reads the FULL RPM note via
// /api/patients/:patientId/rpm-note (org-scoped, read-only). See BILLER_DESIGN.

// Super-admin: manage billers + their clinic assignments (the assignment UI).
router.get("/billers", authRequired, requireRole(...SUPER_ADMIN_ONLY), listBillers);
router.post("/billers", authRequired, requireRole(...SUPER_ADMIN_ONLY), createBiller);
router.put(
  "/billers/:billerId/orgs",
  authRequired,
  requireRole(...SUPER_ADMIN_ONLY),
  setBillerOrgs
);

module.exports = router;
