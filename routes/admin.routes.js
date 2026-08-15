const express = require("express");
const {
  getAllUsers,
  updateUser,
  toggleUserStatus,
  deleteUser,
  getAssignedDoctors,
  updateDoctorAssignments,
} = require("../controllers/admin.controller");
const { authRequired } = require("../middleware/auth");
const { resolveOrgScope, scopePatientParam } = require("../middleware/orgScope");

const router = express.Router();
router.get("/getAllusers", authRequired, resolveOrgScope, getAllUsers);
router.put("/users/:userId", authRequired, resolveOrgScope, updateUser);

// Toggle user status (admin-only)
router.patch(
  "/users/:userId/status",
  authRequired,
  resolveOrgScope,
  toggleUserStatus
);
router.delete("/users/:userId", authRequired, resolveOrgScope, deleteUser);
router.get(
  "/patients/:patientId/doctors",
  authRequired,
  resolveOrgScope,
  scopePatientParam("patientId"),
  getAssignedDoctors
);
router.put(
  "/patients/:patientId/doctors",
  authRequired,
  resolveOrgScope,
  scopePatientParam("patientId"),
  updateDoctorAssignments
);

module.exports = router;
