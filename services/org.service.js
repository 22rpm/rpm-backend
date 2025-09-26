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
  // For MySQL, we need to insert and then get the last inserted ID
  const result = await knex("users").insert({
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
    await trx("role")
      .where({ user_id: parseInt(id) })
      .del();
    await trx("users")
      .where({ id: parseInt(id) })
      .del();
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
  const parsedId = typeof id === "number" ? id : parseInt(id);

  if (isNaN(parsedId)) {
    throw new Error("Invalid user ID");
  }
  return await knex("users").where({ id: parsedId }).first();
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
  getOrganizationsAdmins,
};
