import pool from "../config/db.js"; // adjust path
import {
  findAllUsersWithRoles,
  findUserByEmail,
  updateUser as updateUserService,
  toggleUserStatus as toggleUserStatusService,
  deleteUser as deleteUserService,
} from "../services/admin.service.js"; // note the .js extension

export async function getAllUsers(req, res) {
  try {
    console.log("Fetching all users");

    const isAdmin = true; // TEMP FIX
    if (!isAdmin) {
      return res.status(403).json({ ok: false, message: "Admin access required" });
    }

    const users = await findAllUsersWithRoles();
    console.log("users", users);

    return res.status(200).json({
      ok: true,
      message: "Users fetched successfully",
      users,
    });
  } catch (err) {
    console.error("Error fetching users:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

export async function updateUser(req, res) {
  try {
    const { userId } = req.params;
    const { name, email, phoneNumber, status } = req.body; // read from body

    let is_active = null;
    if (status) {
      if (status.toLowerCase() === "active") is_active = 1;
      else if (status.toLowerCase() === "inactive") is_active = 0;
    }

    await pool.query(
      `UPDATE users 
       SET name = ?, email = ?, phoneNumber = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [name, email, phoneNumber, is_active, userId]
    );

    res.json({ ok: true, message: "User updated successfully" });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ ok: false, message: "Failed to update user" });
  }
}

export async function toggleUserStatus(req, res) {
  try {
    const { userId } = req.params;
    const { status } = req.body;
    const parsedUserId = parseInt(userId);

    if (isNaN(parsedUserId)) {
      return res.status(400).json({ ok: false, message: "Invalid user ID" });
    }

    const isActive = status === "Active";
    const success = await toggleUserStatusService(parsedUserId, isActive);

    if (!success) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    return res.status(200).json({
      ok: true,
      message: `User status updated to ${status}`,
    });
  } catch (err) {
    console.error("Toggle status error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

export async function deleteUser(req, res) {
  console.log("into the delete user");

  try {
    const { userId } = req.params;
    console.log("userId", userId);

    const parsedUserId = parseInt(userId);
    if (isNaN(parsedUserId)) {
      return res.status(400).json({ ok: false, message: "Invalid user ID" });
    }

    // Skip self-delete check for now since no auth
    // if (parsedUserId === req.user.id) { ... }

    const success = await deleteUserService(parsedUserId);
    console.log("success", success);

    if (!success) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    return res.status(200).json({
      ok: true,
      message: "User deleted successfully",
    });
  } catch (err) {
    console.error("Delete user error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}