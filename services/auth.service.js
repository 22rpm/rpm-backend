// services/auth.service.js
const pool = require("../config/db"); // your mysql2 pool

async function deleteRefreshTokenForDevice(
  refreshToken
) {
  const query = `
    DELETE FROM user_devices
    WHERE refresh_token = ?
  `;
  const [result] = await pool.execute(query, [
    refreshToken,
  ]);
  return result.affectedRows > 0;
}

/**
 * Find a user device session from DB
 */
async function findUserDeviceSession({
  userId,
  refreshToken,
  deviceFingerprint,
  userAgent,
  ipAddress,
}) {
  const query = `
    SELECT *
    FROM user_devices
    WHERE user_id = ?
      AND refresh_token = ?
      AND device_fingerprint = ?
      AND user_agent = ?
      AND ip_address = ?
      AND revoked = 0
    LIMIT 1
  `;

  const [rows] = await pool.execute(query, [
    userId ?? null,
    refreshToken ?? null,
    deviceFingerprint ?? null,
    userAgent ?? null,
    ipAddress ?? null,
  ]);

  return rows.length > 0 ? rows[0] : null;
}

module.exports = {
  deleteRefreshTokenForDevice,
  findUserDeviceSession,
};
