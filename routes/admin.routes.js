const express = require("express");
const {
  getAllUsers,
  updateUser,
  toggleUserStatus,
  deleteUser,
  getAssignedDoctors,
  updateDoctorAssignments,
} = require("../controllers/admin.controller");
const { authRequired, requireRole } = require("../middleware/auth");
const { resolveOrgScope, scopePatientParam } = require("../middleware/orgScope");

const router = express.Router();
router.get("/getAllusers", authRequired, resolveOrgScope, getAllUsers);

// User mutation routes. These are admin operations: require an admin/super-admin
// role (requireRole), resolve the caller's org (resolveOrgScope), and confirm
// the TARGET user is in that org before the handler acts (scopePatientParam ->
// 404 on a different org or a missing user, without confirming existence).
router.put(
  "/users/:userId",
  authRequired,
  requireRole("admin", "super-admin"),
  resolveOrgScope,
  scopePatientParam("userId"),
  updateUser
);

// Toggle user status (admin-only)
router.patch(
  "/users/:userId/status",
  authRequired,
  requireRole("admin", "super-admin"),
  resolveOrgScope,
  scopePatientParam("userId"),
  toggleUserStatus
);
router.delete(
  "/users/:userId",
  authRequired,
  requireRole("admin", "super-admin"),
  resolveOrgScope,
  scopePatientParam("userId"),
  deleteUser
);
// Reading a patient's care team: clinicians need this for their own patients,
// admins for management, and super-admin for the org-context clinical view.
router.get(
  "/patients/:patientId/doctors",
  authRequired,
  requireRole("admin", "super-admin", "clinician"),
  resolveOrgScope,
  scopePatientParam("patientId"),
  getAssignedDoctors
);
// Reassigning a patient's care team drives who receives their alerts, so it is
// an admin/super-admin operation only.
router.put(
  "/patients/:patientId/doctors",
  authRequired,
  requireRole("admin", "super-admin"),
  resolveOrgScope,
  scopePatientParam("patientId"),
  updateDoctorAssignments
);

module.exports = router;
