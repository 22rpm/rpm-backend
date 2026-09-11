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
      r.role_type,
      r.user_id as role_user_id
    FROM users u 
    LEFT JOIN role r ON u.id = r.user_id 
    WHERE u.id = ?
  `;

  console.log("🔍 Executing query for user ID:", userId);
  const [rows] = await pool.execute(query, [userId]);

  console.log("🔍 Query result length:", rows.length);
  if (rows[0]) {
    console.log("🔍 User Data:", {
      id: rows[0].id,
      username: rows[0].username,
      org_id: rows[0].org_id,
      role_type: rows[0].role_type,
      role_user_id: rows[0].role_user_id,
    });
  } else {
    console.log("❌ No user found with ID:", userId);
  }

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

// Clinicians (role_type='clinician') with their org name and assigned-patient count.
// orgId null -> across ALL orgs (super-admin, no org filter); a value -> that org only.
// Reference/staff data; no PHI in the row beyond staff contact info.
async function findCliniciansWithCounts(orgId) {
  const where = orgId != null ? "AND u.organization_id = ?" : "";
  const params = orgId != null ? [orgId] : [];
  const query = `
    SELECT u.id, u.username, u.name, u.email, u.phoneNumber, u.is_active,
           u.organization_id AS org_id, o.name AS org_name,
           COALESCE(s.enabled, 1) AS digest_enabled,
           (SELECT COUNT(*) FROM patient_doctor_assignments pda
              WHERE pda.doctor_id = u.id) AS assigned_patient_count
    FROM users u
    JOIN role r ON r.user_id = u.id AND r.role_type = 'clinician'
    LEFT JOIN organizations o ON o.id = u.organization_id
    LEFT JOIN clinician_notification_settings s
      ON s.clinician_id = u.id AND s.type = 'overview_digest'
    WHERE 1=1 ${where}
    ORDER BY o.name IS NULL, o.name, u.name
  `;
  const [rows] = await pool.execute(query, params);
  return rows.map((u) => ({
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email,
    phoneNumber: u.phoneNumber,
    is_active: u.is_active,
    org_id: u.org_id,
    org_name: u.org_name,
    assigned_patient_count: Number(u.assigned_patient_count) || 0,
    // Digest opt-out state (default ON when no row). The UI decides eligibility separately —
    // an on toggle on a clinician with no valid email still means "would receive nothing".
    digest_enabled: !!u.digest_enabled,
  }));
}

// Upsert a clinician's overview-digest opt-out (type 'overview_digest'). Default is ON, so a
// row is only needed to record a change; ON DUPLICATE KEY keeps one row per (clinician,type).
async function setClinicianDigest(clinicianId, enabled) {
  await pool.execute(
    `INSERT INTO clinician_notification_settings (clinician_id, type, enabled, created_at, updated_at)
     VALUES (?, 'overview_digest', ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_at = NOW()`,
    [clinicianId, enabled ? 1 : 0]
  );
}

// Patients assigned to a clinician (via patient_doctor_assignments). orgId scopes the
// patients to that org defensively (the target clinician is already org-checked upstream).
async function findAssignedPatients(doctorId, orgId) {
  const where = orgId != null ? "AND u.organization_id = ?" : "";
  const params = orgId != null ? [doctorId, orgId] : [doctorId];
  const query = `
    SELECT u.id, u.name, u.username, u.email, pda.created_at AS assigned_at
    FROM patient_doctor_assignments pda
    JOIN users u ON u.id = pda.patient_id
    WHERE pda.doctor_id = ? ${where}
    ORDER BY u.name
  `;
  const [rows] = await pool.execute(query, params);
  return rows;
}

module.exports = {
  // New functions
  getUserWithRoleAndOrg,
  findAllUsers,
  testDatabaseConnection,
  findCliniciansWithCounts,
  findAssignedPatients,
  setClinicianDigest,

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
