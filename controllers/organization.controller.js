const bcrypt = require("bcrypt");
const organizationService = require("../services/org.service");

async function addOrganization(req, res) {
  try {
    const { name, code, admin } = req.body;
    const { username, name: adminName, email, password, phoneNumber } = admin;

    const existingOrg = await organizationService.findOrganizationByCode(code);
    if (existingOrg) {
      return res.status(409).json({ ok: false, message: "Organization code already exists" });
    }

    const existingUser = await organizationService.findUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ ok: false, message: "Admin email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const organizationId = await organizationService.createOrganization({ name, code });
    const userId = await organizationService.createUser({
      username,
      name: adminName,
      email,
      password: hashedPassword,
      phoneNumber: phoneNumber || null,
      organization_id: organizationId,
      is_active: true,
    });

    await organizationService.assignRole({
      username,
      userId,
      role: "admin",
    });

    const savedOrg = await organizationService.getOrganizationById(organizationId);
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

async function editOrganization(req, res) {
  try {
    const { id } = req.params;
    const { name, code } = req.body;

    const existingOrg = await organizationService.findOrganizationById(id);
    if (!existingOrg || existingOrg.is_deleted) {
      return res.status(404).json({ ok: false, message: "Organization not found" });
    }

    const existingCode = await organizationService.findOrganizationByCode(code);
    if (existingCode && existingCode.id !== parseInt(id)) {
      return res.status(409).json({ ok: false, message: "Organization code already exists" });
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
    const { username, name, email, password, phoneNumber } = req.body;

    const existingOrg = await organizationService.findOrganizationById(id);
    if (!existingOrg || existingOrg.is_deleted) {
      return res.status(404).json({ ok: false, message: "Organization not found" });
    }

    const existingUser = await organizationService.findUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ ok: false, message: "Admin email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = await organizationService.createUser({
      username,
      name,
      email,
      password: hashedPassword,
      phoneNumber: phoneNumber || null,
      organization_id: id,
      is_active: true,
    });

    await organizationService.assignRole({
      username,
      userId,
      role: "admin",
    });

    const savedUser = await organizationService.findUserById(userId);
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
      return res.status(404).json({ ok: false, message: "Organization not found" });
    }

    await organizationService.softDeleteOrganization(id); // Still calls softDeleteOrganization, but it now performs a hard delete
    return res.status(200).json({ ok: true, message: "Organization deleted successfully" });
  } catch (err) {
    console.error("Delete organization error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function editAdmin(req, res) {
  try {
    const { id } = req.params;
    const { name, email, phoneNumber } = req.body;

    const existingUser = await organizationService.findUserById(id);
    if (!existingUser) {
      return res.status(404).json({ ok: false, message: "Admin not found" });
    }

    const existingEmail = await organizationService.findUserByEmail(email);
    if (existingEmail && existingEmail.id !== parseInt(id)) {
      return res.status(409).json({ ok: false, message: "Email already exists" });
    }

    await organizationService.updateUser(id, { name, email, phoneNumber: phoneNumber || null });
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
    return res.status(500).json({ ok: false, message: "Server error" });
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

    return res.status(200).json({ ok: true, message: "Password reset initiated" });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function toggleAdminStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const user = await organizationService.findUserById(id);
    if (!user) {
      return res.status(404).json({ ok: false, message: "Admin not found" });
    }

    const isActive = status === "Active";
    await organizationService.updateUserStatus(id, isActive);
    return res.status(200).json({
      ok: true,
      message: `Admin status updated to ${status}`,
      admin: { id, status },
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
    return res.status(200).json({ ok: true, message: "Admin deleted successfully" });
  } catch (err) {
    console.error("Delete admin error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function getAllOrganizations(req, res) {
  try {
    const organizations = await organizationService.getAllOrganizations();
    return res.status(200).json({
      ok: true,
      organizations: organizations.map((org) => ({
        id: org.id,
        name: org.name,
        org_code: org.org_code,
        created_at: org.created_at,
        updated_at: org.updated_at,
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

module.exports = {
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
};