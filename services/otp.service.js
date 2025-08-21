const db = require("../config/db");

async function createOtp(userId, otp, type = "login", expiresInMinutes = 5) {
  const createdAt = new Date();
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60000);
  
  await db.query(
    "INSERT INTO otp_tokens (user_id, otp_code, otp_type, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    [userId, otp, type, createdAt, expiresAt]
  );
}

async function verifyOtp(userId, otp, type = "login") {
  const [rows] = await db.query(
    `SELECT * FROM otp_tokens 
     WHERE user_id = ? AND otp_code = ? AND otp_type = ? AND consumed = 0 
       AND expires_at > UTC_TIMESTAMP()
     ORDER BY created_at DESC LIMIT 1`,
    [userId, otp, type]
  );

  console.log(rows);
  

  if (rows.length === 0) return false;

  // mark as consumed
  await db.query("UPDATE otp_tokens SET consumed = 1 WHERE id = ?", [
    rows[0].id,
  ]);

  return true;
}

async function cleanupExpiredOtps() {
  await db.query("DELETE FROM otp_tokens WHERE expires_at < NOW()");
}

module.exports = { createOtp, verifyOtp, cleanupExpiredOtps };
