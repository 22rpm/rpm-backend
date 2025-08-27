const express = require("express");
const { getAllUsers ,updateUser,toggleUserStatus,deleteUser} = require("../controllers/admin.controller");
const { authRequired } = require("../middleware/auth");

const router = express.Router();
router.get("/getAllusers", getAllUsers);
router.put("/users/:userId", updateUser);

// Toggle user status (admin-only)
router.patch("/users/:userId/status", toggleUserStatus);
router.delete("/users/:userId", deleteUser);

module.exports = router;
