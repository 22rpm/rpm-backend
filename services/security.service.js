// services/security.service.js
const db = require('../config/db');

async function getDeviceByHash(userId, fingerprintHash) {
  const [rows] = await db.query(
    'SELECT * FROM user_devices WHERE user_id = ? AND fingerprint_hash = ? LIMIT 1',
    [userId, fingerprintHash]
  );
  return rows[0] || null;
}

async function trustDevice({ userId, fingerprintHash, ip, userAgent, os, device }) {
  const [result] = await db.query(
    `INSERT INTO user_devices (user_id, fingerprint_hash, ip, user_agent, os, device, trusted)
     VALUES (?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE trusted=VALUES(trusted), ip=VALUES(ip), user_agent=VALUES(user_agent), os=VALUES(os), device=VALUES(device), last_seen=CURRENT_TIMESTAMP`,
    [userId, fingerprintHash, ip, userAgent, os, device]
  );
  return result.insertId;
}

async function touchDevice({ userId, fingerprintHash }) {
  await db.query(
    'UPDATE user_devices SET last_seen = CURRENT_TIMESTAMP WHERE user_id = ? AND fingerprint_hash = ?',
    [userId, fingerprintHash]
  );
}

async function getMfa(userId) {
  const [rows] = await db.query('SELECT * FROM user_mfa WHERE user_id = ? LIMIT 1', [userId]);
  return rows[0] || null;
}

async function setMfaSecret(userId, base32) {
  await db.query(
    `INSERT INTO user_mfa (user_id, secret_base32, enabled)
     VALUES (?, ?, 0)
     ON DUPLICATE KEY UPDATE secret_base32 = VALUES(secret_base32)`,
    [userId, base32]
  );
}

async function enableMfa(userId) {
  await db.query('UPDATE user_mfa SET enabled = 1 WHERE user_id = ?', [userId]);
}

module.exports = {
  getDeviceByHash,
  trustDevice,
  touchDevice,
  getMfa,
  setMfaSecret,
  enableMfa,
};
