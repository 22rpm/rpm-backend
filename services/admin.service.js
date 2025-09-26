const pool = require("../config/db");

// ✅ FIXED: Get user with role and organization data
async function getUserWithRoleAndOrg(userId) {
  const query = `
    SELECT 
      u.id, 
      u.username, 
      u.email, 
      u.name, 
      u.phoneNumber, 
      u.organization_id as org_id,
      r.role_type
    FROM users u 
    LEFT JOIN role r ON u.id = r.user_id 
    WHERE u.id = ?
  `;

  const [rows] = await pool.execute(query, [userId]);
  return rows[0] || null;
}

// ✅ FIXED: Get all users (using correct organization_id column)
async function findAllUsers() {
  const query = `
    SELECT 
      u.id, 
      u.username, 
      u.email, 
      u.name, 
      u.phoneNumber, 
      u.is_active, 
      u.last_login, 
      u.organization_id as org_id,
      r.role_type
    FROM users u
    LEFT JOIN role r ON u.id = r.user_id
  `;

  const [rows] = await pool.execute(query);
  return rows.map((user) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    phoneNumber: user.phoneNumber,
    is_active: user.is_active,
    last_login: user.last_login,
    role_type: user.role_type || "user",
    org_id: user.org_id,
  }));
}

// ✅ FIXED: Get users by organization (using correct organization_id column)
async function findOrgUsersWithRoles(orgId) {
  const query = `
    SELECT u.id, u.username, u.email, u.name, u.phoneNumber, 
           u.is_active, u.last_login, u.organization_id as org_id, r.role_type
    FROM users u
    LEFT JOIN role r ON u.id = r.user_id
    WHERE u.organization_id = ?
  `;

  const [rows] = await pool.execute(query, [orgId]);

  return rows.map((user) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    phoneNumber: user.phoneNumber,
    is_active: user.is_active,
    last_login: user.last_login,
    role_type: user.role_type || "user",
    org_id: user.org_id,
  }));
}

// ✅ EXISTING: Get all users with roles
async function findAllUsersWithRoles() {
  const [rows] = await pool.execute(
    `SELECT u.id, u.username, u.email, u.name, u.phoneNumber, u.is_active, u.last_login, r.role_type
     FROM users u
     LEFT JOIN role r ON u.id = r.user_id`
  );

  return rows.map((user) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    phoneNumber: user.phoneNumber,
    is_active: user.is_active,
    last_login: user.last_login,
    role_type: user.role_type || "user",
  }));
}

// ✅ EXISTING: Find user by email
async function findUserByEmail(email) {
  const [rows] = await pool.execute("SELECT * FROM users WHERE email = ?", [
    email,
  ]);
  return rows[0];
}

// ✅ FIXED: Find role by username - changed 'roles' to 'role'
async function findRoleByUsername(username) {
  const [rows] = await pool.execute(
    "SELECT role_type FROM role WHERE username = ? LIMIT 1",
    [username]
  );
  return rows.length > 0 ? rows[0].role_type : null;
}

// ✅ EXISTING: Update user
async function updateUser(userId, { name, email, phoneNumber, isActive }) {
  const [result] = await pool.execute(
    `UPDATE users 
     SET name = ?, email = ?, phone_number = ?, is_active = ?, updated_at = NOW()
     WHERE id = ?`,
    [name, email, phoneNumber, isActive, userId]
  );
  return result.affectedRows > 0;
}

// ✅ FIXED: Update user role - changed 'roles' to 'role'
async function updateUserRole(userId, newRole) {
  const [result] = await pool.execute(
    `INSERT INTO role (user_id, username, role_type)
     VALUES ((SELECT id FROM users WHERE id = ?), (SELECT username FROM users WHERE id = ?), ?)
     ON DUPLICATE KEY UPDATE role_type = ?, updated_at = NOW()`,
    [userId, userId, newRole, newRole]
  );
  return result.affectedRows > 0;
}

// ✅ EXISTING: Delete user
async function deleteUser(userId) {
  // Delete roles first due to foreign key constraint
  await pool.execute(`DELETE FROM role WHERE user_id = ?`, [userId]);
  // Delete user
  const [result] = await pool.execute(`DELETE FROM users WHERE id = ?`, [
    userId,
  ]);
  return result.affectedRows > 0;
}

// ✅ EXISTING: Toggle user status
async function toggleUserStatus(userId, isActive) {
  const [result] = await pool.execute(
    `UPDATE users SET is_active = ?, updated_at = NOW() WHERE id = ?`,
    [isActive, userId]
  );
  return result.affectedRows > 0;
}

// ✅ NEW: Test database connection
async function testDatabaseConnection() {
  try {
    const [rows] = await pool.execute("SELECT 1 as test");
    console.log("✅ Database connection test successful");
    return true;
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    return false;
  }
}

module.exports = {
  // New functions
  getUserWithRoleAndOrg,
  findAllUsers,
  testDatabaseConnection,

  // Existing functions
  findAllUsersWithRoles,
  findOrgUsersWithRoles,
  findUserByEmail,
  findRoleByUsername,
  updateUser,
  updateUserRole,
  deleteUser,
  toggleUserStatus,
};
