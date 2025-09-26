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
  const [userId] = await knex("users")
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
    })
    .returning("id");
  return userId.id;
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
  const parsedId = parseInt(id);
  if (isNaN(parsedId)) {
    throw new Error("Invalid user ID");
  }
  return await knex("users").where({ id: parsedId }).first();
}

module.exports = {
  createOrganization,
  findOrganizationById,
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
};
