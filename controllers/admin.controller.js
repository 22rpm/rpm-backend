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

// Role lives in the separate `role` table (users has no role column), keyed by
// user_id. Take the most recent role row, matching how auth resolves a role.
async function getUserRoleType(userId) {
  // Most-privileged-wins, not newest-wins: a stale/newer lower-privilege row must
  // never lower a user's effective role. With UNIQUE(role.user_id) this returns
  // the single row; the ordering is defense-in-depth on an authorization primitive.
  const [rows] = await pool.query(
    `SELECT role_type FROM role WHERE user_id = ?
      ORDER BY CASE role_type
        WHEN 'super-admin' THEN 5
        WHEN 'admin' THEN 4
        WHEN 'clinician' THEN 3
        WHEN 'care_manager' THEN 2
        WHEN 'patient' THEN 1
        ELSE 0 END DESC,
        id ASC
      LIMIT 1`,
    [userId]
  );
  return rows[0]?.role_type || null;
}

// A non-super-admin must never modify a super-admin account (privilege
// escalation). Org membership + existence are already enforced upstream by
// scopePatientParam("userId"); this only adds the role protection on top.
// Returns true (and sends a 403) if the request must be blocked.
async function blockedSuperAdminTarget(req, res, targetUserId) {
  const targetRole = await getUserRoleType(targetUserId);
  if (targetRole === "super-admin" && req.user.role_type !== "super-admin") {
    res.status(403).json({
      ok: false,
      message: "You are not allowed to modify a super-admin account",
    });
    return true;
  }
  return false;
}

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
    console.log("🔍 Resolved org scope:", req.orgScope);

    // Both org admins and super-admins may list users, but always within the
    // single organization resolved by the orgScope middleware:
    //   - admin        -> their own organization (req.orgScope === their org)
    //   - super-admin  -> the organization they selected via ?organizationId=
    // req.orgScope is authoritative; a client-supplied org is never trusted here.
    if (role_type === "admin" || role_type === "super-admin") {
      if (req.orgScope === undefined || req.orgScope === null) {
        return res.status(400).json({
          ok: false,
          message: "No organization context resolved",
        });
      }

      console.log("✅ Fetching users for org:", req.orgScope);
      const users = await findOrgUsersWithRoles(req.orgScope);
      return res.status(200).json({
        ok: true,
        message: "Users fetched successfully",
        users,
      });
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

    // A non-super-admin may not modify a super-admin account.
    if (await blockedSuperAdminTarget(req, res, userId)) return;

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

    // A non-super-admin may not modify a super-admin account.
    if (await blockedSuperAdminTarget(req, res, parsedUserId)) return;

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

    // Restore the self-delete guard now that req.user exists.
    if (parsedUserId === Number(req.user.id)) {
      return res
        .status(400)
        .json({ ok: false, message: "You cannot delete your own account" });
    }

    // A non-super-admin may not delete a super-admin account.
    if (await blockedSuperAdminTarget(req, res, parsedUserId)) return;

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
    // REDACTED: log a count, not the rows. See SECURITY_FOLLOWUPS.
    console.log("patientRows count:", patientRows.length);

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
  // REDACTED: req.user is the full JWT payload (name/email/phone/role/org). Id only.
  console.log("assign doctors — actor:", req.user?.id);

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
