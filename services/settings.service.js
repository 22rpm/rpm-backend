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

  // Reject a username already taken by another user with a clear conflict rather
  // than a duplicate-key error. This guards even before UNIQUE(users.username)
  // lands; the ER_DUP_ENTRY catch below is the post-migration backstop.
  if (username) {
    const [dupe] = await pool.execute(
      "SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1",
      [username, userId]
    );
    if (dupe.length) {
      const error = new Error("Username already taken");
      error.code = "USERNAME_TAKEN";
      throw error;
    }
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
  try {
    await pool.execute(query, values);
  } catch (err) {
    // Backstop for the UNIQUE(users.username)/email constraints (post-migration).
    if (err && err.code === "ER_DUP_ENTRY") {
      const dupEmail = /email/i.test(err.message || "");
      const e = new Error(
        dupEmail ? "Email already taken" : "Username already taken"
      );
      e.code = dupEmail ? "EMAIL_TAKEN" : "USERNAME_TAKEN";
      throw e;
    }
    throw err;
  }

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
