const pool = require("../config/db");

async function updateSettingsService(userId, { name, username, email, phone }) {
  // Check unique username
  if (username) {
    const [rows] = await pool.execute(
      "SELECT id FROM users WHERE username = ? AND id != ?",
      [username, userId]
    );
    if (rows.length > 0) {
      const error = new Error("Username already taken");
      error.code = "USERNAME_TAKEN";
      throw error;
    }
  }

  // Check unique email
  if (email) {
    const [rows] = await pool.execute(
      "SELECT id FROM users WHERE email = ? AND id != ?",
      [email, userId]
    );
    if (rows.length > 0) {
      const error = new Error("Email already taken");
      error.code = "EMAIL_TAKEN";
      throw error;
    }
  }

  // Build dynamic query
  const fields = [];
  const values = [];

  if (name) {
    fields.push("name = ?");
    values.push(name);
  }
  if (username) {
    fields.push("username = ?");
    values.push(username);
  }
  if (email) {
    fields.push("email = ?");
    values.push(email);
  }
  if (phone) {
    fields.push("phoneNumber = ?"); // ✅ matches schema
    values.push(phone);
  }

  if (fields.length === 0) {
    return null; // nothing to update
  }

  values.push(userId);

  // Update `users` table
  const query = `UPDATE users SET ${fields.join(", ")} WHERE id = ?`;
  await pool.execute(query, values);

  // If username updated, also update in `role` table
  if (username) {
    await pool.execute("UPDATE role SET username = ? WHERE user_id = ?", [
      username,
      userId,
    ]);
  }

  // Return updated user
  const [updated] = await pool.execute(
    "SELECT id, name, username, email, phoneNumber FROM users WHERE id = ?",
    [userId]
  );
  return updated[0];
}

module.exports = { updateSettingsService };
