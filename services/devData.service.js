// services/devData.service.js
const db = require('../config/db');

async function insertDevData(jsonData) {
  // dev_id is null for now, updated_at is handled later
  const [result] = await db.query(
    'INSERT INTO dev_data (dev_id, data) VALUES (?, ?)',
    [null, JSON.stringify(jsonData)]
  );
  return result.insertId; // returns the new row ID
}

module.exports = { insertDevData };
