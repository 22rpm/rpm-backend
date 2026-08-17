// services/user.service.js
const db = require("../config/db");

async function findUserByEmail(email) {
  console.log("🧠 findUserByEmail called with:", email);
  const [rows] = await db.query(
    "SELECT id, username, name, email, password, phoneNumber, created_at, organization_id, updated_at FROM users WHERE email = ? LIMIT 1",
    [email]
  );
  console.log("📊 Query result for email:", rows);
  return rows[0] || null;
}

// Join by username to avoid INT/VARCHAR mismatch in your current schema.
// Prefer joining on user_id once schema is fixed.
async function findRoleByUsername(username) {
  const [rows] = await db.query(
    "SELECT role_type FROM role WHERE username = ? ORDER BY id DESC LIMIT 1",
    [username]
  );
  return rows[0]?.role_type || null;
}

async function createUser({
  username,
  name,
  email,
  password,
  phoneNumber,
  is_active,
  organization_id, // Add this parameter
}) {
  const [result] = await db.query(
    `INSERT INTO users (username, name, email, password, phoneNumber, is_active, organization_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`, // Add organization_id placeholder
    [username, name, email, password, phoneNumber, is_active, organization_id] // Add organization_id value
  );
  return result.insertId;
}

async function assignRole({ username, userId, role }) {
  await db.query(
    "INSERT INTO role (username, user_id, role_type) VALUES (?, ?, ?)",
    [username, userId, role]
  );
}

async function updateLastLogin(userId) {
  await db.query("UPDATE users SET last_login = NOW() WHERE id = ?", [userId]);
}

async function getUserById(userId) {
  const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [userId]);
  return rows[0] || null;
}
async function findUserByUsername(username) {
  console.log("🧠 findUserByUsername called with:", username);
  const [rows] = await db.query(
    "SELECT id, username, name, email, password, phoneNumber, created_at, organization_id, updated_at FROM users WHERE username = ? LIMIT 1",
    [username]
  );
  console.log("📊 Query result for username:", rows);
  return rows[0] || null;
}
// Look up a user by phone number.
//
// Matches on the last 10 digits so stored formats (+1..., dashes, spaces,
// parentheses) don't have to agree with what the patient types.
//
// NOTE: phoneNumber is not unique in the schema. If two accounts share a
// number, this returns the most recent and logs a warning.
async function findUserByPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 7) return null;

  const tail = digits.slice(-10);
  const [rows] = await db.query(
    `SELECT id, username, name, email, password, phoneNumber, organization_id,
            created_at, updated_at
     FROM users
     WHERE phoneNumber IS NOT NULL
       AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phoneNumber,'+',''),'-',''),' ',''),'(',''),')','') LIKE ?
     ORDER BY id DESC`,
    [`%${tail}`]
  );

  if (rows.length > 1) {
    console.warn(
      `⚠️  ${rows.length} users match phone ending ${tail} — using id ${rows[0].id}`
    );
  }
  return rows[0] || null;
}
module.exports = {
  findUserByEmail,
  findRoleByUsername,
  findUserByPhone,
  createUser,
  assignRole,
  findUserByUsername,
  updateLastLogin,
  getUserById,
};
