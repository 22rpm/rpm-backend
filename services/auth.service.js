// services/auth.service.js
const pool = require("../config/db"); // your mysql2 pool

async function deleteRefreshTokenForDevice(
  userId,
  deviceFingerprint,
  refreshToken
) {
  const query = `
    DELETE FROM user_devices
    WHERE user_id = ? AND device_fingerprint = ? AND refresh_token = ?
  `;
  const [result] = await pool.execute(query, [
    userId,
    deviceFingerprint,
    refreshToken,
  ]);
  return result.affectedRows > 0;
}

module.exports = {
  deleteRefreshTokenForDevice,
};
