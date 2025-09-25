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
  await knex("organizations")
    .where({ id: parsedId })
    .update({
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
    .select("*");
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
  // For MySQL, we need to insert and then get the last inserted ID
  const result = await knex("users")
    .insert({
      username,
      name,
      email,
      password,
      phoneNumber: phoneNumber || null,
      organization_id,
      is_active,
      created_at: new Date(),
      updated_at: new Date(),
    });

  // For MySQL, result[0] contains the insert ID
  const userId = result[0];
  console.log("User created with ID:", userId, "Type:", typeof userId);
  return userId;
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

async function updateUser(id, { name, email, phoneNumber, password }) {
  const updateData = {
    name,
    email: email.toLowerCase(),
    phoneNumber: phoneNumber !== undefined ? phoneNumber : null, // Handle undefined properly
    updated_at: new Date(),
  };

  console.log("Update data before password hash:", updateData);

  // Include hashed password if provided
  if (password && password.trim() !== "") {
    const hashedPassword = await bcrypt.hash(password, 10);
    updateData.password = hashedPassword;
    console.log("Password will be updated");
  }

  console.log("Final update data for database:", updateData);

  const result = await knex("users")
    .where({ id: parseInt(id) })
    .update(updateData);

  console.log("Update result:", result);
  return result;
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
    await trx("role").where({ user_id: parseInt(id) }).del();
    await trx("users").where({ id: parseInt(id) }).del();
  });
}

async function assignRole({ username, userId, role }) {
  await knex("role").insert({
    username,
    user_id: userId,
    role_type: role,
    created_at: new Date(),
    updated_at: new Date(),
  });
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
  console.log("Finding user with ID:", id, "Type:", typeof id);
  
  // If id is already a number, use it directly
  const parsedId = typeof id === 'number' ? id : parseInt(id);
  
  if (isNaN(parsedId)) {
    throw new Error(`Invalid user ID: ${id}`);
  }
  
  return await knex("users")
    .where({ id: parsedId })
    .first();
}
// In services/org.service.js

// In services/org.service.js

async function getAllOrganizationsWithAdminCount() {
  try {
    const organizations = await knex('organizations as o')
      .leftJoin('users as u', 'o.id', 'u.organization_id')
      .where('o.is_deleted', 0)
      .select(
        'o.id',
        'o.name',
        'o.org_code',
        'o.created_at',
        'o.updated_at',
        knex.raw('COUNT(u.id) as admin_count')
      )
      .groupBy('o.id', 'o.name', 'o.org_code', 'o.created_at', 'o.updated_at')
      .orderBy('o.created_at', 'desc');
    
    return organizations;
  } catch (error) {
    console.error('Error fetching organizations with admin count:', error);
    throw error;
  }
}

async function getAdminCountByOrganizationId(organizationId) {
  try {
    const result = await knex('users')
      .where('organization_id', organizationId)
      .count('id as admin_count')
      .first();
    
    return result.admin_count;
  } catch (error) {
    console.error('Error counting admins:', error);
    return 0;
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
module.exports = {
  createOrganization,
  findOrganizationById,
  getAllOrganizationsWithAdminCount,
  findOrganizationByCode,
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
  getOrganizationsAdmins
};