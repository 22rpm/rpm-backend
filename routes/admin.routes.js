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

const router = express.Router();
router.get("/getAllusers", authRequired, getAllUsers);
router.put("/users/:userId", updateUser);

// Toggle user status (admin-only)
router.patch("/users/:userId/status", toggleUserStatus);
router.delete("/users/:userId", deleteUser);
router.get("/patients/:patientId/doctors", authRequired, getAssignedDoctors);
router.put(
  "/patients/:patientId/doctors",
  authRequired,
  updateDoctorAssignments
);

module.exports = router;
