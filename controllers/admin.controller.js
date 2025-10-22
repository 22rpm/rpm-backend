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
import bcrypt from "bcrypt";
export async function getAllUsers(req, res) {
  try {
    const currentUserId = req.user.id;
    console.log("🔍 Current User ID:", currentUserId);

    if (!currentUserId) {
      console.log("Unauthorized access attempt to getAllUsers");
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    // ✅ Fetch complete user data with role from database
    const currentUser = await getUserWithRoleAndOrg(currentUserId);
    console.log("🔍 Current User Data:", JSON.stringify(currentUser, null, 2));

    if (!currentUser) {
      return res.status(403).json({ ok: false, message: "User not found" });
    }

    const role_type = currentUser.role_type;
    const org_id = currentUser.org_id;

    console.log("🔍 Role Type:", role_type);
    console.log("🔍 Org ID:", org_id);
    console.log("🔍 Role Type === 'admin':", role_type === "admin");

    // ✅ Check if user is admin
    if (role_type === "admin") {
      console.log("✅ User is admin, proceeding...");

      // ✅ Org Admin - has org_id
      if (org_id) {
        console.log("🔍 User is Org Admin, fetching org users...");
        const users = await findOrgUsersWithRoles(org_id);
        return res.status(200).json({
          ok: true,
          message: "Users fetched successfully",
          users,
        });
      }
      // ✅ Super Admin - no org_id
      else {
        console.log("🔍 User is Super Admin, fetching all users...");
        const allUsers = await findAllUsers();
        return res.status(200).json({
          ok: true,
          message: "All users fetched successfully (Super Admin)",
          users: allUsers,
        });
      }
    }

    console.log("❌ Access denied - Role check failed");
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
    const { name, email, phoneNumber, status, password } = req.body;

    let is_active = null;
    if (status) {
      if (status.toLowerCase() === "active") is_active = 1;
      else if (status.toLowerCase() === "inactive") is_active = 0;
    }

    // Build the update query dynamically
    let updateFields = [
      "name = ?",
      "email = ?",
      "phoneNumber = ?",
      "is_active = ?",
      "updated_at = CURRENT_TIMESTAMP",
    ];
    let queryParams = [name, email, phoneNumber, is_active];

    // Add password to update if provided
    if (password && password.trim() !== "") {
      // Hash the password before storing
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      updateFields.push("password = ?");
      queryParams.push(hashedPassword);
    }

    // Add userId as the last parameter for WHERE clause
    queryParams.push(userId);

    const query = `UPDATE users SET ${updateFields.join(", ")} WHERE id = ?`;

    await pool.query(query, queryParams);

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

// Get assigned doctors for a patient
export async function getAssignedDoctors(req, res) {
  const { patientId } = req.params;
  console.log("patientId", patientId);

  try {
    // First get the patient's organization_id
    const [patientRows] = await pool.query(
      `SELECT organization_id FROM users WHERE id = ?`,
      [patientId]
    );
    console.log("patientRows", patientRows);

    if (patientRows.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "Patient not found",
      });
    }

    const organizationId = patientRows[0].organization_id;
    console.log("organizationId from patient:", organizationId);

    const [rows] = await pool.query(
      `
      SELECT u.id, u.name, u.email, u.phoneNumber
      FROM patient_doctor_assignments pda
      JOIN users u ON pda.doctor_id = u.id
      WHERE pda.patient_id = ? AND u.organization_id = ?
      `,
      [patientId, organizationId]
    );

    res.json({ ok: true, doctors: rows });
  } catch (err) {
    console.error("Get assigned doctors error:", err);
    res.status(500).json({ ok: false, message: "Server error" });
  }
}
// Update doctor assignments for a patient (add/remove)
// Update doctor assignments for a patient (add/remove)
export async function updateDoctorAssignments(req, res) {
  const { patientId } = req.params;
  console.log("patientId", patientId);

  const { addDoctorIds = [], removeDoctorIds = [] } = req.body;
  const assignedBy = req.user.id;
  console.log("user req", req.user);

  console.log("addDoctorIds", addDoctorIds);
  console.log("removeDoctorIds", removeDoctorIds);

  if (!Array.isArray(addDoctorIds) || !Array.isArray(removeDoctorIds)) {
    return res.status(400).json({
      ok: false,
      message: "addDoctorIds and removeDoctorIds must be arrays",
    });
  }

  // Convert IDs to numbers to ensure type consistency
  const numericAddDoctorIds = addDoctorIds.map(Number);
  const numericRemoveDoctorIds = removeDoctorIds.map(Number);
  console.log("numericAddDoctorIds", numericAddDoctorIds);
  console.log("numericRemoveDoctorIds", numericRemoveDoctorIds);

  try {
    // First get the patient's organization_id
    const [patientRows] = await pool.query(
      `SELECT id, organization_id FROM users WHERE id = ?`,
      [patientId]
    );

    if (patientRows.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "Patient not found",
      });
    }

    const organizationId = patientRows[0].organization_id;
    console.log("organizationId from patient:", organizationId);

    // Validate doctors exist and are clinicians in the same org
    const allDoctorIds = [...numericAddDoctorIds, ...numericRemoveDoctorIds];

    if (allDoctorIds.length > 0) {
      const [doctors] = await pool.query(
        `
        SELECT u.id
        FROM users u
        JOIN role r ON u.id = r.user_id
        WHERE u.id IN (?) 
          AND r.role_type = 'clinician' 
          AND u.organization_id = ?
          AND u.is_active = 1
        `,
        [allDoctorIds, organizationId]
      );

      console.log(`Valid doctors found:`, doctors);

      const validDoctorIds = doctors.map((d) => d.id);
      console.log("Valid doctor IDs:", validDoctorIds);

      const invalidAddIds = numericAddDoctorIds.filter(
        (id) => !validDoctorIds.includes(id)
      );
      const invalidRemoveIds = numericRemoveDoctorIds.filter(
        (id) => !validDoctorIds.includes(id)
      );

      if (invalidAddIds.length > 0 || invalidRemoveIds.length > 0) {
        return res.status(400).json({
          ok: false,
          message: `Invalid doctor IDs: ${[
            ...invalidAddIds,
            ...invalidRemoveIds,
          ].join(", ")}`,
        });
      }
    }

    // Start transaction to ensure atomicity
    await pool.query("START TRANSACTION");

    // Add new assignments (only if not already assigned)
    if (numericAddDoctorIds.length > 0) {
      // First check which assignments already exist to avoid duplicates
      const [existingAssignments] = await pool.query(
        "SELECT doctor_id FROM patient_doctor_assignments WHERE patient_id = ? AND doctor_id IN (?)",
        [patientId, numericAddDoctorIds]
      );

      const existingDoctorIds = existingAssignments.map((row) => row.doctor_id);
      const newDoctorIds = numericAddDoctorIds.filter(
        (id) => !existingDoctorIds.includes(id)
      );

      if (newDoctorIds.length > 0) {
        const values = newDoctorIds.map((doctorId) => [
          patientId,
          doctorId,
          assignedBy,
        ]);
        await pool.query(
          "INSERT INTO patient_doctor_assignments (patient_id, doctor_id, assigned_by) VALUES ?",
          [values]
        );
        console.log(`Added ${newDoctorIds.length} new doctor assignments`);
      }
    }

    // Remove assignments
    if (numericRemoveDoctorIds.length > 0) {
      const [result] = await pool.query(
        "DELETE FROM patient_doctor_assignments WHERE patient_id = ? AND doctor_id IN (?)",
        [patientId, numericRemoveDoctorIds]
      );
      console.log(`Removed ${result.affectedRows} doctor assignments`);
    }

    await pool.query("COMMIT");

    res.json({
      ok: true,
      message: "Doctor assignments updated successfully",
    });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("Update doctor assignments error:", err);
    res.status(500).json({
      ok: false,
      message: "Server error",
      error: err.message,
    });
  }
}
