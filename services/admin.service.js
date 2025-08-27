const pool = require("../config/db"); // Adjust the path to your database configuration

async function findAllUsersWithRoles() {
  const [rows] = await pool.execute(
    `SELECT u.id, u.username, u.email, u.name, u.phoneNumber, u.is_active, u.last_login, r.role_type
     FROM users u
     LEFT JOIN role r ON u.id = r.user_id`
  );

  return rows.map(user => ({
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
async function findUserByEmail(email) {
  const [rows] = await pool.execute("SELECT * FROM users WHERE email = ?", [email]);
  return rows[0];
}

async function findRoleByUsername(username) {
  const [rows] = await pool.execute(
    "SELECT role_type FROM roles WHERE username = ? LIMIT 1",
    [username]
  );
  return rows.length > 0 ? rows[0].role_type : null;
}

async function updateUser(userId, { name, email, phoneNumber, isActive }) {
  const [result] = await pool.execute(
    `UPDATE users 
     SET name = ?, email = ?, phone_number = ?, is_active = ?, updated_at = NOW()
     WHERE id = ?`,
    [name, email, phoneNumber, isActive, userId]
  );
  return result.affectedRows > 0;
}

async function updateUserRole(userId, newRole) {
  const [result] = await pool.execute(
    `INSERT INTO roles (user_id, username, role_type) 
     VALUES ((SELECT id FROM users WHERE id = ?), (SELECT username FROM users WHERE id = ?), ?)
     ON DUPLICATE KEY UPDATE role_type = ?, updated_at = NOW()`,
    [userId, userId, newRole, newRole]
  );
  return result.affectedRows > 0;
}

async function deleteUser(userId) {
  // Delete roles first due to foreign key constraint
  await pool.execute(`DELETE FROM role WHERE user_id = ?`, [userId]);
  // Delete user
  const [result] = await pool.execute(`DELETE FROM users WHERE id = ?`, [userId]);
  return result.affectedRows > 0;
}

async function toggleUserStatus(userId, isActive) {
  const [result] = await pool.execute(
    `UPDATE users SET is_active = ?, updated_at = NOW() WHERE id = ?`,
    [isActive, userId]
  );
  return result.affectedRows > 0;
}

module.exports = {
  findAllUsersWithRoles,
  findUserByEmail,
  findRoleByUsername,
  updateUser,
  updateUserRole,
  deleteUser,
  toggleUserStatus,
};