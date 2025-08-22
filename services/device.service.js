// services/device.service.js
const db = require("../config/db");

async function saveOrUpdateUserDevice({
  userId,
  deviceFingerprint,
  ipAddress,
  userAgent,
  refreshToken,
  absoluteExpiresAt
}) {
  const [rows] = await db.query(
    "SELECT id FROM user_devices WHERE user_id = ? AND device_fingerprint = ? LIMIT 1",
    [userId, deviceFingerprint]
  );

  if (rows[0]) {
    await db.query(
      `UPDATE user_devices
       SET refresh_token = ?, ip_address = ?, user_agent = ?,
           last_used_at = NOW(), last_activity_at = NOW(),
           absolute_expires_at = ?, revoked = 0, updated_at = NOW()
       WHERE id = ?`,
      [refreshToken, ipAddress, userAgent, absoluteExpiresAt, rows[0].id]
    );
  } else {
    await db.query(
      `INSERT INTO user_devices
       (user_id, device_fingerprint, ip_address, user_agent, refresh_token,
        last_used_at, last_activity_at, absolute_expires_at, revoked)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW(), ?, 0)`,
      [userId, deviceFingerprint, ipAddress, userAgent, refreshToken, absoluteExpiresAt]
    );
  }
}

module.exports = { saveOrUpdateUserDevice };
