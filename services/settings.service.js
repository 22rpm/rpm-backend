const pool = require("../config/db");

async function updateSettingsService(
  userId,
  { name, username, email, phoneNumber }
) {
  // Basic validation
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error("Invalid email format");
    error.code = "INVALID_EMAIL";
    throw error;
  }
  if (phoneNumber && !/^\+?[\d\s-]{10,15}$/.test(phoneNumber)) {
    const error = new Error("Invalid phone number format");
    error.code = "INVALID_PHONE";
    throw error;
  }

  // Build dynamic query arrays
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
  if (phoneNumber) {
    fields.push("phoneNumber = ?");
    values.push(phoneNumber);
  }

  // Nothing to update
  if (fields.length === 0) {
    return null;
  }

  values.push(userId);

  // Update users table
  const query = `UPDATE users SET ${fields.join(", ")} WHERE id = ?`;
  await pool.execute(query, values);

  // If username updated, also update in role table
  if (username) {
    await pool.execute("UPDATE role SET username = ? WHERE user_id = ?", [
      username,
      String(userId),
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
