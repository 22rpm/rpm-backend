import pool from "../config/db.js"; // adjust path
import {
  findAllUsersWithRoles,
  findUserByEmail,
  updateUser as updateUserService,
  toggleUserStatus as toggleUserStatusService,
  deleteUser as deleteUserService,
  findOrgUsersWithRoles,
  getUserWithRoleAndOrg,
  findAllUsers,
} from "../services/admin.service.js"; // note the .js extension

export async function getAllUsers(req, res) {
  try {
    const currentUserId = req.user.id;

    if (!currentUserId) {
      console.log("Unauthorized access attempt to getAllUsers");
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    // ✅ Fetch complete user data with role from database
    const currentUser = await getUserWithRoleAndOrg(currentUserId);
    console.log("Current user data from database:", currentUser);

    if (!currentUser) {
      return res.status(403).json({ ok: false, message: "User not found" });
    }

    const role_type = currentUser.role_type;
    const org_id = currentUser.org_id;

    console.log("Extracted role_type:", role_type);
    console.log("Extracted org_id:", org_id);

    // ✅ Check if user is admin
    if (role_type === "admin") {
      // ✅ Org Admin - has org_id
      if (org_id) {
        console.log(
          "User is org admin, fetching org users for org_id:",
          org_id
        );
        const users = await findOrgUsersWithRoles(org_id);
        return res.status(200).json({
          ok: true,
          message: "Users fetched successfully",
          users,
        });
      }
      // ✅ Super Admin - no org_id
      else {
        console.log("User is super admin, fetching all users");
        const allUsers = await findAllUsers();
        return res.status(200).json({
          ok: true,
          message: "All users fetched successfully (Super Admin)",
          users: allUsers,
        });
      }
    }

    console.log("Access denied - User role:", role_type);
    return res.status(403).json({
      ok: false,
      message: `Access denied. Admin privileges required. Current role: ${role_type}`,
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
