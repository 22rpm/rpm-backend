const bcrypt = require("bcrypt");
const organizationService = require("../services/org.service");
const db = require("../config/db");
async function addOrganization(req, res) {
  try {
    const { name, code, admin } = req.body;
    const { username, name: adminName, email, password, phoneNumber } = admin;

    console.log("Starting organization creation process:", {
      name,
      code,
      adminEmail: email,
    });

    // Check if organization code already exists
    const existingOrg = await organizationService.findOrganizationByCode(code);
    if (existingOrg) {
      console.log("Organization code already exists:", code);
      return res
        .status(409)
        .json({ ok: false, message: "Organization code already exists" });
    }

    // Check if admin email already exists
    const existingUser = await organizationService.findUserByEmail(email);
    if (existingUser) {
      console.log("Admin email already exists:", email);
      return res
        .status(409)
        .json({ ok: false, message: "Admin email already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    console.log("Password hashed successfully");

    // Create organization
    const organizationId = await organizationService.createOrganization({
      name,
      code,
    });
    console.log("Organization created with ID:", organizationId);

    // Create admin user
    const userId = await organizationService.createUser({
      username,
      name: adminName,
      email,
      password: hashedPassword,
      phoneNumber: phoneNumber || null,
      organization_id: organizationId,
      is_active: true,
    });
    console.log("Admin user created with ID:", userId);

    // Assign admin role
    console.log("Assigning admin role to user:", {
      username,
      userId,
      role: "admin",
    });
    await organizationService.assignRole({
      username,
      userId,
      role: "admin",
    });
    console.log("Admin role assigned successfully");

    // Get the saved organization details
    const savedOrg = await organizationService.getOrganizationById(
      organizationId
    );

    console.log(
      "Organization creation completed successfully for:",
      savedOrg.name
    );

    return res.status(201).json({
      ok: true,
      message: "Organization created successfully",
      organization: {
        id: savedOrg.id,
        name: savedOrg.name,
        code: savedOrg.org_code,
        createdAt: savedOrg.created_at,
      },
    });
  } catch (err) {
    console.error("Add organization error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function createUser({
  username,
  name,
  email,
  password,
  phoneNumber,
  organization_id,
  is_active,
}) {
  try {
    console.log("Creating user in database:", {
      username,
      email,
      organization_id,
    });

    // For MySQL, we need to insert and then get the last inserted ID
    const result = await knex("users").insert({
      username,
      name,
      email,
      password,
      phoneNumber: phoneNumber || null, // Use the correct column name
      organization_id,
      is_active,
      created_at: new Date(),
      updated_at: new Date(),
    });

    console.log("User insert result:", result);

    // For MySQL, result[0] contains the insert ID
    const userId = result[0];

    if (!userId) {
      // If we can't get the ID from insert result, query for the user
      console.log("Getting user ID by querying with email...");
      const users = await knex("users")
        .select("id")
        .where("email", email)
        .limit(1);

      if (users.length === 0) {
        throw new Error("Failed to create user or get user ID");
      }

      const userId = users[0].id;
      console.log("User ID retrieved from query:", userId);
      return userId;
    }

    console.log("User created successfully with ID:", userId);
    return userId;
  } catch (error) {
    console.error("Error in createUser function:", error);
    throw error;
  }
}

async function editOrganization(req, res) {
  try {
    const { id } = req.params;
    const { name, code } = req.body;

    const existingOrg = await organizationService.findOrganizationById(id);
    if (!existingOrg || existingOrg.is_deleted) {
      return res
        .status(404)
        .json({ ok: false, message: "Organization not found" });
    }

    const existingCode = await organizationService.findOrganizationByCode(code);
    if (existingCode && existingCode.id !== parseInt(id)) {
      return res
        .status(409)
        .json({ ok: false, message: "Organization code already exists" });
    }

    await organizationService.updateOrganization(id, { name, code });
    const updatedOrg = await organizationService.getOrganizationById(id);
    return res.status(200).json({
      ok: true,
      message: "Organization updated successfully",
      organization: {
        id: updatedOrg.id,
        name: updatedOrg.name,
        code: updatedOrg.org_code,
        createdAt: updatedOrg.created_at,
      },
    });
  } catch (err) {
    console.error("Edit organization error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function addAdminToOrganization(req, res) {
  try {
    const { id } = req.params;
    console.log("org id ", id);
    const { username, name, email, password, phoneNumber } = req.body;

    const existingOrg = await organizationService.findOrganizationById(id);
    if (!existingOrg || existingOrg.is_deleted) {
      return res
        .status(404)
        .json({ ok: false, message: "Organization not found" });
    }

    const existingUser = await organizationService.findUserByEmail(email);
    if (existingUser) {
      return res
        .status(409)
        .json({ ok: false, message: "Admin email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = await organizationService.createUser({
      username,
      name,
      email,
      password: hashedPassword,
      phoneNumber: phoneNumber || null,
      organization_id: parseInt(id), // Ensure it's a number
      is_active: true,
    });

    console.log("user id", userId, "Type:", typeof userId);

    await organizationService.assignRole({
      username,
      userId,
      role: "admin",
    });

    const savedUser = await organizationService.findUserById(userId);
    console.log("saved user", savedUser);

    return res.status(201).json({
      ok: true,
      message: "Admin added successfully",
      admin: {
        id: savedUser.id,
        username: savedUser.username,
        name: savedUser.name,
        email: savedUser.email,
        phoneNumber: savedUser.phoneNumber,
        role: "admin",
      },
    });
  } catch (err) {
    console.error("Add admin error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function deleteOrganization(req, res) {
  try {
    const { id } = req.params;
    const existingOrg = await organizationService.findOrganizationById(id);
    if (!existingOrg) {
      return res
        .status(404)
        .json({ ok: false, message: "Organization not found" });
    }

    await organizationService.softDeleteOrganization(id); // Still calls softDeleteOrganization, but it now performs a hard delete
    return res
      .status(200)
      .json({ ok: true, message: "Organization deleted successfully" });
  } catch (err) {
    console.error("Delete organization error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function editAdmin(req, res) {
  try {
    const { id } = req.params;
    const { name, email, phoneNumber, password } = req.body;

    console.log("Request body:", req.body);
    console.log("Admin ID:", id);

    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({
        ok: false,
        message: "Name and email are required",
      });
    }

    const existingUser = await organizationService.findUserById(id);
    if (!existingUser) {
      return res.status(404).json({ ok: false, message: "Admin not found" });
    }

    // Check if email already exists (excluding current user)
    const existingEmail = await organizationService.findUserByEmail(email);
    if (existingEmail && existingEmail.id !== parseInt(id)) {
      return res
        .status(409)
        .json({ ok: false, message: "Email already exists" });
    }

    // Prepare update data - preserve existing phoneNumber if not provided
    const updateData = {
      name: name.trim(),
      email: email.trim(),
      // Only update phoneNumber if it's provided (not undefined)
      phoneNumber:
        phoneNumber !== undefined
          ? phoneNumber || null
          : existingUser.phoneNumber,
    };

    // Only include password if provided and not empty
    if (password && password.trim() !== "") {
      updateData.password = password.trim();
    }

    console.log("Final update data:", updateData);

    await organizationService.updateUser(id, updateData);
    const updatedUser = await organizationService.findUserById(id);

    return res.status(200).json({
      ok: true,
      message: "Admin updated successfully",
      admin: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        phoneNumber: updatedUser.phoneNumber,
      },
    });
  } catch (err) {
    console.error("Edit admin error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error while updating admin",
    });
  }
}

async function resetPassword(req, res) {
  try {
    const { id } = req.params;
    const { email } = req.body;

    const user = await organizationService.findUserById(id);
    if (!user) {
      return res.status(404).json({ ok: false, message: "Admin not found" });
    }

    if (user.email !== email) {
      return res.status(400).json({ ok: false, message: "Invalid email" });
    }

    // In a real implementation, generate and send a new password or reset link
    const newPassword = Math.random().toString(36).slice(-8);
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await organizationService.updateUserPassword(id, hashedPassword);

    // Placeholder for sending email
    console.log(`Password reset for ${email}. New password: ${newPassword}`);

    return res
      .status(200)
      .json({ ok: true, message: "Password reset initiated" });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function toggleAdminStatus(req, res) {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    const user = await organizationService.findUserById(id);
    if (!user) {
      return res.status(404).json({ ok: false, message: "Admin not found" });
    }

    // Validate that is_active is 0 or 1
    if (typeof is_active !== "number" || ![0, 1].includes(is_active)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid is_active value; must be 0 or 1",
      });
    }

    // Use is_active directly (already 0 or 1)
    const newIsActive = is_active;

    await organizationService.updateUserStatus(id, newIsActive);
    return res.status(200).json({
      ok: true,
      message: `Admin status updated to ${
        newIsActive === 1 ? "Active" : "Inactive"
      }`,
      admin: { id, is_active: newIsActive },
    });
  } catch (err) {
    console.error("Toggle admin status error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function deleteAdmin(req, res) {
  try {
    const { id } = req.params;
    const user = await organizationService.findUserById(id);
    if (!user) {
      return res.status(404).json({ ok: false, message: "Admin not found" });
    }

    await organizationService.deleteUser(id);
    return res
      .status(200)
      .json({ ok: true, message: "Admin deleted successfully" });
  } catch (err) {
    console.error("Delete admin error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function getAllOrganizations(req, res) {
  try {
    const organizations =
      await organizationService.getAllOrganizationsWithAdminCount();

    return res.status(200).json({
      ok: true,
      organizations: organizations.map((org) => ({
        id: org.id,
        name: org.name,
        org_code: org.org_code,
        created_at: org.created_at,
        updated_at: org.updated_at,
        admin_count: parseInt(org.admin_count) || 0,
      })),
    });
  } catch (err) {
    console.error("Get all organizations error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function getAllAdmins(req, res) {
  try {
    const admins = await organizationService.getAllAdmins();
    return res.status(200).json({
      ok: true,
      users: admins.map((user) => ({
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        is_active: user.is_active,
        last_login: user.last_login,
        organization_id: user.organization_id,
        role_type: user.role_type,
      })),
    });
  } catch (err) {
    console.error("Get all admins error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}
async function getOrganizationAdmins(req, res) {
  try {
    const { id } = req.params; // Organization ID from the route parameter

    // Fetch admins for the organization
    const admins = await organizationService.getOrganizationsAdmins(id);

    return res.status(200).json({
      ok: true,
      admins: admins.map((admin) => ({
        id: admin.id,
        name: admin.name,
        email: admin.email,
        organization_id: admin.organization_id,
        created_at: admin.created_at,
        updated_at: admin.updated_at,
        is_active: admin.is_active,
        phoneNumber: admin.phoneNumber,
      })),
    });
  } catch (err) {
    console.error("Get organization admins error:", err);
    if (err.message === "Organization not found") {
      return res
        .status(404)
        .json({ ok: false, message: "Organization not found" });
    }
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// Get all doctors by organization ID
async function getDoctorsByOrganization(req, res) {
  try {
    const { organizationId } = req.params;

    // Validate organizationId
    if (!organizationId || isNaN(parseInt(organizationId))) {
      return res.status(400).json({
        ok: false,
        message: "Valid organization ID is required",
      });
    }

    // Query to get doctors from the specific organization
    const [doctors] = await db.query(
      `
      SELECT 
        u.id,
        u.name,
        u.username,
        u.email,
        u.phoneNumber,
        u.is_active
      FROM users u
      INNER JOIN role ur ON u.id = ur.user_id
      WHERE u.organization_id = ? 
        AND ur.role_type = 'clinician'
        AND u.is_active = true
      ORDER BY u.name ASC
    `,
      [organizationId]
    );

    return res.status(200).json({
      ok: true,
      doctors: doctors.map((doctor) => ({
        id: doctor.id,
        name: doctor.name,
        username: doctor.username,
        email: doctor.email,
        phoneNumber: doctor.phoneNumber,
        is_active: doctor.is_active,
      })),
    });
  } catch (err) {
    console.error("Get doctors error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error while fetching doctors",
    });
  }
}
module.exports = {
  getDoctorsByOrganization,
  addOrganization,
  editOrganization,
  addAdminToOrganization,
  deleteOrganization,
  editAdmin,
  resetPassword,
  toggleAdminStatus,
  deleteAdmin,
  getAllOrganizations,
  getAllAdmins,
  getOrganizationAdmins,
};
