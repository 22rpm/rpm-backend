const express = require("express");
const jwt = require("jsonwebtoken");
const knex = require("../config/knex");
const { authRequired } = require("../middleware/auth");
const { getIO, userSockets } = require("../socket/socketServer");

const router = express.Router();

// Debug endpoint to check connected users
router.get("/debug-connected-users", (req, res) => {
  const connectedUsers = Array.from(userSockets.entries());
  console.log("🔍 DEBUG: Currently connected users:", connectedUsers);

  res.json({
    ok: true,
    connected_users: connectedUsers.map(([userId, socketId]) => ({
      user_id: userId,
      socket_id: socketId,
    })),
    total_connected: connectedUsers.length,
  });
});

// Test endpoint to send direct notification
router.post("/test-notification", async (req, res) => {
  const { doctor_id, message } = req.body;

  console.log("🧪 TEST: Sending direct notification to doctor:", doctor_id);
  console.log("📊 Currently connected:", Array.from(userSockets.entries()));

  const io = getIO();
  const doctorSocketId = userSockets.get(doctor_id.toString());

  if (doctorSocketId) {
    io.to(doctorSocketId).emit("test_notification", {
      message: message || "Test notification from server!",
      timestamp: new Date(),
      doctor_id: doctor_id,
    });

    res.json({
      ok: true,
      message: `Test notification sent to doctor ${doctor_id}`,
      socket_id: doctorSocketId,
    });
  } else {
    res.status(404).json({
      ok: false,
      message: `Doctor ${doctor_id} not connected`,
      connected_users: Array.from(userSockets.keys()),
    });
  }
});

// TEMPORARY TEST ROUTE - Remove this after testing
router.post("/test-alert", async (req, res) => {
  const { dr_ids, type, desc, patient_id = 15 } = req.body;

  console.log("🚨 TEST Alert creation request received:");
  console.log("   Patient ID:", patient_id);
  console.log("   Doctor IDs:", dr_ids);
  console.log("   Alert Type:", type);
  console.log("   Description:", desc);

  // Validate input
  if (
    !dr_ids ||
    !Array.isArray(dr_ids) ||
    dr_ids.length === 0 ||
    !type ||
    !["high", "medium", "low"].includes(type)
  ) {
    return res.status(400).json({
      ok: false,
      message:
        "Invalid request: dr_ids (non-empty array) and valid type required",
    });
  }

  try {
    // DEBUG: Check what's in the role table for these users
    console.log("🔍 DEBUG: Checking role table for users:", dr_ids);
    const roleCheck = await knex("role")
      .select("user_id", "role_type")
      .whereIn("user_id", dr_ids);

    console.log("🔍 DEBUG: Role table entries found:", roleCheck);

    // DEBUG: Check users table
    console.log("🔍 DEBUG: Checking users table for IDs:", dr_ids);
    const usersCheck = await knex("users")
      .select("id", "name", "is_active")
      .whereIn("id", dr_ids);

    console.log("🔍 DEBUG: Users found:", usersCheck);

    // Verify all dr_ids exist and are doctors by checking the role table
    const validDoctors = await knex("users")
      .select("users.id", "users.name", "users.email", "role.role_type")
      .join("role", "users.id", "role.user_id")
      .whereIn("users.id", dr_ids)
      .where("role.role_type", "clinician")
      .where("users.is_active", true);

    console.log("✅ Valid doctors found:", validDoctors.length);
    console.log(
      "   Doctor details:",
      validDoctors.map((d) => ({ id: d.id, name: d.name, role: d.role_type }))
    );

    if (validDoctors.length !== dr_ids.length) {
      const foundDoctorIds = validDoctors.map((d) => d.id);
      const missingDoctors = dr_ids.filter(
        (id) => !foundDoctorIds.includes(id)
      );
      return res.status(400).json({
        ok: false,
        message: "One or more doctor IDs are invalid or not doctors",
        missing_doctors: missingDoctors,
        valid_doctors: foundDoctorIds,
      });
    }

    // Start transaction to ensure atomicity
    const result = await knex.transaction(async (trx) => {
      // Insert alert
      const [alertId] = await trx("alerts")
        .insert({
          user_id: patient_id,
          desc: desc || `Health alert with severity: ${type}`,
          type,
        })
        .returning("id");

      console.log("📝 Alert inserted with ID:", alertId);

      // Insert assignments for each doctor
      const assignments = dr_ids.map((doctor_id) => ({
        alert_id: alertId,
        doctor_id,
      }));
      await trx("alert_assignments").insert(assignments);

      // Fetch the alert for response/notification
      const newAlert = await trx("alerts").where("id", alertId).first();
      return { alertId, newAlert };
    });

    // Send WebSocket notifications to all doctors
    const io = getIO();
    console.log("📡 Sending WebSocket notifications to doctors:", dr_ids);
    console.log(
      "📊 Currently connected sockets:",
      Array.from(userSockets.entries())
    );

    let notificationsSent = 0;
    dr_ids.forEach((doctor_id) => {
      const doctorSocketId = userSockets.get(doctor_id.toString());
      console.log(`   Checking doctor ${doctor_id} - socket:`, doctorSocketId);

      if (doctorSocketId) {
        io.to(doctorSocketId).emit("new_alert", {
          alert: result.newAlert,
          patient_id,
          timestamp: new Date(),
        });
        console.log(`   ✅ Notification sent to doctor ${doctor_id}`);
        notificationsSent++;
      } else {
        console.log(
          `   ❌ Doctor ${doctor_id} not connected - no active socket`
        );
      }
    });

    res.status(201).json({
      ok: true,
      message: `Alert created. Notifications sent to ${notificationsSent}/${dr_ids.length} doctors`,
      alert: result.newAlert,
      notifications_sent: notificationsSent,
      total_doctors: dr_ids.length,
    });
  } catch (error) {
    console.error("❌ Error creating alert:", error);
    res
      .status(500)
      .json({ ok: false, message: "Server error", error: error.message });
  }
});

// Original alert route (with auth)
router.post("/", authRequired, async (req, res) => {
  const { dr_ids, type, desc } = req.body;
  const patient_id = req.user.id;

  console.log("🚨 Alert creation request received:");
  console.log("   Patient ID:", patient_id);
  console.log("   Doctor IDs:", dr_ids);
  console.log("   Alert Type:", type);
  console.log("   Description:", desc);

  // Validate input
  if (
    !dr_ids ||
    !Array.isArray(dr_ids) ||
    dr_ids.length === 0 ||
    !type ||
    !["high", "medium", "low"].includes(type)
  ) {
    return res.status(400).json({
      ok: false,
      message:
        "Invalid request: dr_ids (non-empty array) and valid type required",
    });
  }

  try {
    // Verify all dr_ids exist and are doctors by checking the role table
    const validDoctors = await knex("users")
      .select("users.id", "users.name", "users.email", "role.role_type")
      .join("role", "users.id", "role.user_id")
      .whereIn("users.id", dr_ids)
      .where("role.role_type", "doctor")
      .where("users.is_active", true);

    console.log("✅ Valid doctors found:", validDoctors.length);

    if (validDoctors.length !== dr_ids.length) {
      return res.status(400).json({
        ok: false,
        message: "One or more doctor IDs are invalid or not doctors",
      });
    }

    // Start transaction to ensure atomicity
    const result = await knex.transaction(async (trx) => {
      // Insert alert
      const [alertId] = await trx("alerts")
        .insert({
          user_id: patient_id,
          desc: desc || `Health alert with severity: ${type}`,
          type,
        })
        .returning("id");

      // Insert assignments for each doctor
      const assignments = dr_ids.map((doctor_id) => ({
        alert_id: alertId,
        doctor_id,
      }));
      await trx("alert_assignments").insert(assignments);

      // Fetch the alert for response/notification
      const newAlert = await trx("alerts").where("id", alertId).first();
      return { alertId, newAlert };
    });

    // Send WebSocket notifications to all doctors
    const io = getIO();
    console.log("📡 Sending WebSocket notifications to doctors:", dr_ids);

    let notificationsSent = 0;
    dr_ids.forEach((doctor_id) => {
      const doctorSocketId = userSockets.get(doctor_id.toString());
      if (doctorSocketId) {
        io.to(doctorSocketId).emit("new_alert", {
          alert: result.newAlert,
          patient_id,
          timestamp: new Date(),
        });
        console.log(`   ✅ Notification sent to doctor ${doctor_id}`);
        notificationsSent++;
      } else {
        console.log(
          `   ❌ Doctor ${doctor_id} not connected; alert saved but not notified in real-time`
        );
      }
    });

    res.status(201).json({
      ok: true,
      message: `Alert created. Notifications sent to ${notificationsSent}/${dr_ids.length} doctors`,
      alert: result.newAlert,
    });
  } catch (error) {
    console.error("Error creating alert:", error);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

module.exports = router;
