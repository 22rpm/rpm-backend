// routes/billing.routes.js
//
// The biller surface (/api/billing). Read-only, minimum-necessary billing views
// gated to BILLING_READ_ROLES (biller + admin/super-admin oversight), plus
// super-admin-only biller management. The roster overview stays on
// /api/patients/billing-summary (shared with clinical staff).
const express = require("express");
const router = express.Router();
const { authRequired, requireRole } = require("../middleware/auth");
const { resolveOrgScope, scopePatientParam } = require("../middleware/orgScope");
const { BILLING_READ_ROLES, SUPER_ADMIN_ONLY } = require("../config/roles");
const {
  getMyOrgs,
  getBillingNote,
  getBillingDemographics,
  listBillers,
  createBiller,
  setBillerOrgs,
} = require("../controllers/billing.controller");

// The caller's allowed clinics (biller clinic selector). No org scope — this is
// pre-selection (which clinics may I pick).
router.get("/my-orgs", authRequired, requireRole(...BILLING_READ_ROLES), getMyOrgs);

// Per-patient billing reads. resolveOrgScope validates the biller's org (allowed
// set); scopePatientParam confirms the patient is in that org.
router.get(
  "/patients/:patientId/note",
  authRequired,
  requireRole(...BILLING_READ_ROLES),
  resolveOrgScope,
  scopePatientParam("patientId"),
  getBillingNote
);
router.get(
  "/patients/:patientId/demographics",
  authRequired,
  requireRole(...BILLING_READ_ROLES),
  resolveOrgScope,
  scopePatientParam("patientId"),
  getBillingDemographics
);

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
