const db = require("../db"); // your MySQL pool

const createDeviceDataService = async (username, devId, bpData) => {
  // ensure device belongs to user
  const [devices] = await db.query(
    "SELECT id FROM devices WHERE id = ? AND username = ?",
    [devId, username]
  );

  if (devices.length === 0) {
    throw new Error("Device not found or does not belong to this user");
  }

  // insert reading into dev_data
  const [result] = await db.query(
    "INSERT INTO dev_data (dev_id, data) VALUES (?, ?)",
    [devId, JSON.stringify(bpData)]
  );

  return {
    insertId: result.insertId,
    devId,
    bpData,
  };
};

const createBPDataService = async (user, bpData) => {
  const username = user.email || user.id; // depends on what you keep in token

  // Step 1: Find or register BP device for this user
  let deviceId;
  const [existing] = await db.query(
    "SELECT id FROM devices WHERE username = ? AND dev_type = ?",
    [username, "BP"]
  );

  if (existing.length > 0) {
    deviceId = existing[0].id;
  } else {
    const [insertRes] = await db.query(
      "INSERT INTO devices (username, name, dev_type) VALUES (?, ?, ?)",
      [username, "Blood Pressure Monitor", "BP"]
    );
    deviceId = insertRes.insertId;
  }

  // Step 2: Insert BP data into dev_data
  const [result] = await db.query(
    "INSERT INTO dev_data (dev_id, data) VALUES (?, ?)",
    [deviceId, JSON.stringify(bpData)]
  );

  return {
    insertId: result.insertId,
    devId: deviceId,
    bpData,
  };
};

module.exports = { createDeviceDataService, createBPDataService };
