// seedBpData.js
// Generates realistic BP readings for a patient in dev_data.
// Run from the rpm-backend root:  node seedBpData.js
//
// Usage:
//   node seedBpData.js                 -> seeds user 48, 45 days of readings
//   node seedBpData.js 48 60           -> seeds user 48, 60 days
//   node seedBpData.js 48 45 --reset   -> wipes that user's readings first

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const db = require("./config/db");

// ---- config -------------------------------------------------------------
const USER_ID = Number(process.argv[2]) || 48;
const DAYS = Number(process.argv[3]) || 45;
const RESET = process.argv.includes("--reset");
const DEV_ID = `BP-SIM-${USER_ID}`;
const DEV_TYPE = "bp";

// Mirrors calculateBPStatus in services/deviceData.service.js
function calculateBPStatus(s, d) {
  const sVal = Number(s);
  const dVal = Number(d);
  if (Number.isNaN(sVal) || Number.isNaN(dVal)) return "Normal";
  if (sVal > 180 || dVal > 120) return "Emergency";
  if (sVal > 140 || dVal > 99) return "High";
  if (sVal < 90 || dVal < 60) return "Low";
  return "Normal";
}

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Most readings sit in a believable band for a monitored hypertensive
// patient, with occasional excursions so the dashboard has variety.
function generateReading() {
  const roll = Math.random();
  let systolic, diastolic;

  if (roll < 0.62) {
    // Normal
    systolic = randInt(112, 132);
    diastolic = randInt(70, 84);
  } else if (roll < 0.9) {
    // High
    systolic = randInt(141, 165);
    diastolic = randInt(88, 99);
  } else if (roll < 0.97) {
    // Low
    systolic = randInt(84, 92);
    diastolic = randInt(52, 62);
  } else {
    // Emergency — rare, exercises the alert path
    systolic = randInt(182, 198);
    diastolic = randInt(112, 124);
  }

  return { systolic, diastolic, bpm: randInt(58, 96) };
}

function pad(n) {
  return String(n).padStart(2, "0");
}

async function seed() {
  let conn;
  try {
    conn = await db.getConnection();

    // Confirm the patient exists before writing anything
    const [users] = await conn.execute(
      "SELECT id, username, name FROM users WHERE id = ?",
      [USER_ID]
    );
    if (users.length === 0) {
      console.error(`No user with id ${USER_ID}. Aborting.`);
      return;
    }
    console.log(`Seeding for: ${users[0].name} (${users[0].username}, id ${USER_ID})`);

    if (RESET) {
      const [del] = await conn.execute(
        "DELETE FROM dev_data WHERE user_id = ? AND dev_type = ?",
        [USER_ID, DEV_TYPE]
      );
      console.log(`Reset: removed ${del.affectedRows} existing readings.`);
    }

    // Ensure the device row exists (same shape the app creates)
    const [existing] = await conn.execute(
      "SELECT id FROM devices WHERE dev_id = ? AND user_id = ?",
      [DEV_ID, USER_ID]
    );
    if (existing.length === 0) {
      await conn.execute(
        "INSERT INTO devices (dev_id, user_id, dev_type) VALUES (?, ?, ?)",
        [DEV_ID, USER_ID, DEV_TYPE]
      );
      console.log(`Registered device ${DEV_ID}.`);
    } else {
      console.log(`Device ${DEV_ID} already registered.`);
    }

    const counts = { Normal: 0, High: 0, Low: 0, Emergency: 0 };
    let total = 0;

    for (let dayOffset = DAYS - 1; dayOffset >= 0; dayOffset--) {
      // 1-3 readings per day, occasionally none (patients miss days)
      if (Math.random() < 0.12) continue;
      const perDay = randInt(1, 3);

      for (let i = 0; i < perDay; i++) {
        const when = new Date();
        when.setDate(when.getDate() - dayOffset);
        // Morning, midday, evening slots with jitter
        const baseHour = [7, 13, 20][i] ?? 20;
        when.setHours(baseHour + randInt(0, 1), randInt(0, 59), randInt(0, 59), 0);

        const { systolic, diastolic, bpm } = generateReading();
        const bpStatus = calculateBPStatus(systolic, diastolic);
        counts[bpStatus]++;

        const dateStr = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
        const timeStr = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
        const mysqlTs = `${dateStr} ${timeStr}:${pad(when.getSeconds())}`;

        const payload = {
          systolic,
          diastolic,
          bpm,
          date: dateStr,
          time: timeStr,
          result: bpStatus,
          bpStatus,
        };

        await conn.execute(
          "INSERT INTO dev_data (dev_id, user_id, dev_type, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          [DEV_ID, USER_ID, DEV_TYPE, JSON.stringify(payload), mysqlTs, mysqlTs]
        );
        total++;
      }
    }

    console.log(`\nInserted ${total} readings across ${DAYS} days:`);
    console.log(`  Normal:    ${counts.Normal}`);
    console.log(`  High:      ${counts.High}`);
    console.log(`  Low:       ${counts.Low}`);
    console.log(`  Emergency: ${counts.Emergency}`);
    console.log(`\nNote: alerts are generated by the API path, not by this script.`);
  } catch (err) {
    console.error("Seed failed:", err);
  } finally {
    if (conn) conn.release();
    console.log("Database connection released.");
  }
}

seed();
