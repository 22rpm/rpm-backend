const bcrypt = require("bcrypt");
const knex = require("knex")(require("../knexfile").development);

async function createOrganization({ name, code }) {
  const [organizationId] = await knex("organizations").insert({
    name,
    org_code: code,
    created_at: new Date(),
    updated_at: new Date(),
    is_deleted: false, // Explicitly set is_deleted to false for new organizations
  });
  return organizationId; // Return the ID directly
}

async function findOrganizationById(id) {
  return await knex("organizations")
    .where({ id: parseInt(id) })
    .first();
}

async function findOrganizationByCode(code) {
  return await knex("organizations")
    .where({ org_code: code, is_deleted: false })
    .first();
}
async function updateOrganization(id, { name, code }) {
  const parsedId = parseInt(id);
  if (isNaN(parsedId)) {
    throw new Error("Invalid organization ID");
  }
  await knex("organizations")
    .where({ id: parsedId, is_deleted: false })
    .update({
      name,
      org_code: code,
      updated_at: new Date(),
    });
}

async function softDeleteOrganization(id) {
  const parsedId = parseInt(id);
  if (isNaN(parsedId)) {
    throw new Error("Invalid organization ID");
  }
  await knex("organizations").where({ id: parsedId }).update({
    is_deleted: true,
    updated_at: new Date(),
  });
}
async function getOrganizationById(id) {
  const parsedId = parseInt(id);
  if (isNaN(parsedId)) {
    throw new Error("Invalid organization ID");
  }
  return await knex("organizations")
    .where({ id: parsedId, is_deleted: false })
    .first();
}

async function getAllOrganizations() {
  return await knex("organizations")
    .where({ is_deleted: false })
    .select(
      "organizations.id",
      "organizations.name",
      "organizations.org_code",
      "organizations.created_at",
      "organizations.updated_at",
      knex.raw(`
        (SELECT COUNT(*) 
         FROM users 
         JOIN roles ON users.id = roles.user_id 
         WHERE users.organization_id = organizations.id 
         AND roles.role_type = 'admin') as total_admins
      `)
    );
}

// User and role functions remain unchanged
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

    const result = await knex("users")
      .insert({
        username,
        name,
        email,
        password,
        phone_number: phoneNumber || null, // Fixed: changed phoneNumber to phone_number if that's your column name
        organization_id,
        is_active,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning("id");

    console.log("User creation result:", result);

    // Handle different return formats from different databases
    const userId = Array.isArray(result) ? result[0]?.id : result?.id;

    if (!userId) {
      throw new Error("Failed to get user ID after creation");
    }

    console.log("User created successfully with ID:", userId);
    return userId;
  } catch (error) {
    console.error("Error in createUser function:", error);
    throw error;
  }
}
async function findOrganizationById(id) {
  const parsedId = parseInt(id);
  if (isNaN(parsedId)) {
    throw new Error("Invalid organization ID");
  }
  return await knex("organizations")
    .where({ id: parsedId, is_deleted: false })
    .first();
}

async function findUserByEmail(email) {
  return await knex("users").where({ email }).first();
}

async function updateUser(id, { name, email, phoneNumber }) {
  await knex("users")
    .where({ id: parseInt(id) })
    .update({
      name,
      email,
      phoneNumber: phoneNumber || null,
      updated_at: new Date(),
    });
}

async function updateUserPassword(id, hashedPassword) {
  await knex("users")
    .where({ id: parseInt(id) })
    .update({
      password: hashedPassword,
      updated_at: new Date(),
    });
}

async function updateUserStatus(id, isActive) {
  await knex("users")
    .where({ id: parseInt(id) })
    .update({
      is_active: isActive,
      updated_at: new Date(),
    });
}

async function deleteUser(id) {
  await knex.transaction(async (trx) => {
    await trx("role")
      .where({ user_id: parseInt(id) })
      .del();
    await trx("users")
      .where({ id: parseInt(id) })
      .del();
  });
}

async function assignRole({ username, userId, role }) {
  try {
    console.log("Assigning role in database:", { username, userId, role });

    if (!userId) {
      throw new Error("User ID is null or undefined when assigning role");
    }

    const result = await knex("role")
      .insert({
        username,
        user_id: userId,
        role_type: role,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning("id");

    console.log("Role assigned successfully, role ID:", result);
    return result;
  } catch (error) {
    console.error("Error in assignRole function:", error);
    throw error;
  }
}

async function getAllAdmins() {
  return await knex("users")
    .join("role", "users.id", "=", "role.user_id")
    .where({ "role.role_type": "admin" })
    .select(
      "users.id",
      "users.username",
      "users.name",
      "users.email",
      "users.phoneNumber",
      "users.is_active",
      "users.last_login",
      "users.organization_id",
      "role.role_type"
    );
}
async function findUserById(id) {
  const parsedId = parseInt(id);
  if (isNaN(parsedId)) {
    throw new Error("Invalid user ID");
    throw new Error("Invalid user ID");
  }
  return await knex("users").where({ id: parsedId }).first();
}
async function getAllOrganizationsWithAdminCount() {
  try {
    const organizations = await knex("organizations as o")
      .leftJoin("users as u", "o.id", "u.organization_id")
      .where("o.is_deleted", 0)
      .select(
        "o.id",
        "o.name",
        "o.org_code",
        "o.created_at",
        "o.updated_at",
        knex.raw("COUNT(u.id) as admin_count")
      )
      .groupBy("o.id", "o.name", "o.org_code", "o.created_at", "o.updated_at")
      .orderBy("o.created_at", "desc");

    return organizations;
  } catch (error) {
    console.error("Error fetching organizations with admin count:", error);
    throw error;
  }
}
async function getOrganizationsAdmins(organizationId) {
  try {
    // Check if the organization exists and is not deleted
    const organization = await knex("organizations")
      .where({ id: organizationId, is_deleted: 0 })
      .first();

    if (!organization) {
      throw new Error("Organization not found");
    }

    // Fetch admins for the organization
    const admins = await knex("users")
      .where({ organization_id: organizationId })
      .select(
        "id",
        "name",
        "email",
        "organization_id",
        "created_at",
        "updated_at",
        "is_active",
        "phoneNumber"
      )
      .orderBy("created_at", "desc");

    return admins;
  } catch (error) {
    console.error("Error fetching organization admins:", error);
    throw error;
  }
}
async function getAllOrganizationsWithAdminCount() {
  try {
    const organizations = await knex("organizations as o")
      .leftJoin("users as u", "o.id", "u.organization_id")
      .where("o.is_deleted", 0)
      .select(
        "o.id",
        "o.name",
        "o.org_code",
        "o.created_at",
        "o.updated_at",
        knex.raw("COUNT(u.id) as admin_count")
      )
      .groupBy("o.id", "o.name", "o.org_code", "o.created_at", "o.updated_at")
      .orderBy("o.created_at", "desc");

    return organizations;
  } catch (error) {
    console.error("Error fetching organizations with admin count:", error);
    throw error;
  }
}
module.exports = {
  createOrganization,
  findOrganizationById,
  findOrganizationByCode,
  getAllOrganizationsWithAdminCount,
  getOrganizationsAdmins,
  updateOrganization,
  softDeleteOrganization,
  getOrganizationById,
  getAllOrganizations,
  createUser,
  findUserById,
  findUserByEmail,
  updateUser,
  updateUserPassword,
  updateUserStatus,
  deleteUser,
  assignRole,
  getAllAdmins,
};
