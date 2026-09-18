const express = require("express");
const {
  getAllUsers,
  updateUser,
  toggleUserStatus,
  deleteUser,
  getAssignedDoctors,
  updateDoctorAssignments,
  getClinicians,
  getUserPatients,
  digestStatus,
  setDigestPref,
} = require("../controllers/admin.controller");
const { adminSendReset } = require("../controllers/passwordReset.controller");
const { authRequired, requireRole } = require("../middleware/auth");
const { ADMIN_ROLES, ADMIN_OR_CLINICIAN } = require("../config/roles");
const { resolveOrgScope, scopePatientParam } = require("../middleware/orgScope");

const router = express.Router();
router.get("/getAllusers", authRequired, resolveOrgScope, getAllUsers);

// Super-admin clinician management (CLINICIAN_MANAGEMENT_DESIGN.md).
// Clinician list: admin sees own org; super-admin sees one org (?organizationId=) or ALL
// orgs (omitted). NO resolveOrgScope here — the all-orgs case has no single scope, so the
// handler derives it from the caller's role. requireRole gates to admin/super-admin.
router.get("/clinicians", authRequired, requireRole(...ADMIN_ROLES), getClinicians);
// Digest health (last weekly/monthly run + counts + overdue) — CLINICIAN_OVERVIEW_DESIGN P1.
router.get("/digest-status", authRequired, requireRole(...ADMIN_ROLES), digestStatus);
// A clinician's assigned patients. Org-scoped like the other /users/:userId routes:
// scopePatientParam confirms the target is in req.orgScope (404 otherwise).
router.get(
  "/users/:userId/patients",
  authRequired,
  requireRole(...ADMIN_ROLES),
  resolveOrgScope,
  scopePatientParam("userId"),
  getUserPatients
);
// Set a clinician's overview-digest opt-out (default ON). Org-scoped like the routes above.
router.patch(
  "/users/:userId/digest",
  authRequired,
  requireRole(...ADMIN_ROLES),
  resolveOrgScope,
  scopePatientParam("userId"),
  setDigestPref
);

// User mutation routes. These are admin operations: require an admin/super-admin
// role (requireRole), resolve the caller's org (resolveOrgScope), and confirm
// the TARGET user is in that org before the handler acts (scopePatientParam ->
// 404 on a different org or a missing user, without confirming existence).
router.put(
  "/users/:userId",
  authRequired,
  requireRole(...ADMIN_ROLES),
  resolveOrgScope,
  scopePatientParam("userId"),
  updateUser
);

// Admin-initiated password reset (PASSWORD_RECOVERY_DESIGN.md PR-2): emails a reset code to the
// patient's on-file address so the patient sets their own password — staff never see or set it.
// ADMIN-ONLY by decision (account-takeover blast radius; not widened to all staff yet), org-scoped
// to the target like the other user-mutation routes. Replaces the removed decoy "Reset Password".
router.post(
  "/users/:userId/send-password-reset",
  authRequired,
  requireRole(...ADMIN_ROLES),
  resolveOrgScope,
  scopePatientParam("userId"),
  adminSendReset
);

// Toggle user status (admin-only)
router.patch(
  "/users/:userId/status",
  authRequired,
  requireRole(...ADMIN_ROLES),
  resolveOrgScope,
  scopePatientParam("userId"),
  toggleUserStatus
);
router.delete(
  "/users/:userId",
  authRequired,
  requireRole(...ADMIN_ROLES),
  resolveOrgScope,
  scopePatientParam("userId"),
  deleteUser
);
// Reading a patient's care team: clinicians need this for their own patients,
// admins for management, and super-admin for the org-context clinical view.
router.get(
  "/patients/:patientId/doctors",
  authRequired,
  requireRole(...ADMIN_OR_CLINICIAN),
  resolveOrgScope,
  scopePatientParam("patientId"),
  getAssignedDoctors
);
// Reassigning a patient's care team drives who receives their alerts, so it is
// an admin/super-admin operation only.
router.put(
  "/patients/:patientId/doctors",
  authRequired,
  requireRole(...ADMIN_ROLES),
  resolveOrgScope,
  scopePatientParam("patientId"),
  updateDoctorAssignments
);

module.exports = router;
