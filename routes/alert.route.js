const express = require("express");
const jwt = require("jsonwebtoken");
const knex = require("../config/knex");
const { authRequired } = require("../middleware/auth");
const {
  getIO,
  userSockets,
  getConnectedUsers,
  isUserConnected,
} = require("../socket/socketServer");

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
// In your alert route file

router.post("/test-alert", async (req, res) => {
  const { dr_ids, type, desc, patient_id = 15 } = req.body;

  console.log("=".repeat(60));
  console.log("🚨 TEST ALERT CREATION REQUEST");
  console.log("=".repeat(60));
  console.log("   Patient ID:", patient_id);
  console.log("   Doctor IDs:", dr_ids);
  console.log("   Alert Type:", type);
  console.log("   Description:", desc);

  try {
    // Get all connected users BEFORE processing
    const connectedUsersBefore = getConnectedUsers();
    console.log("📊 Connected users BEFORE alert:", connectedUsersBefore);

    // ... your existing validation and alert creation code ...

    // Send WebSocket notifications to all clinicians
    const io = getIO();
    
    console.log("📡 Sending WebSocket notifications to clinicians:", dr_ids);
    
    let notificationsSent = 0;

    // Send notifications to each clinician
    for (const clinician_id of dr_ids) {
      const clinicianSocketId = userSockets.get(clinician_id.toString());
      const isConnected = isUserConnected(clinician_id);
      
      console.log(`   👨‍⚕️ Clinician ${clinician_id}:`, {
        socketId: clinicianSocketId,
        isConnected: isConnected,
        inUserSockets: userSockets.has(clinician_id.toString())
      });

      if (clinicianSocketId && isConnected) {
        // Get updated unread count for this clinician
        const unreadCount = await knex("alert_assignments")
          .where("doctor_id", clinician_id)
          .andWhere("read_status", false)
          .count("id as count")
          .first();

        // Create alert data
        const alertData = {
          alert: {
            ...result.newAlert,
            read_status: false,
            assignment_id: clinician_id,
          },
          patient: patientDetails,
          unread_count: parseInt(unreadCount?.count) || 0,
          timestamp: new Date(),
        };

        // 🔥 TRY MULTIPLE METHODS TO SEND ALERT

        // Method 1: Send to user room
        io.to(`user_${clinician_id}`).emit("new_alert", alertData);
        console.log(`   ✅ Method 1: Sent to room user_${clinician_id}`);

        // Method 2: Send to specific socket
        io.to(clinicianSocketId).emit("new_alert", alertData);
        console.log(`   ✅ Method 2: Sent to socket ${clinicianSocketId}`);

        // Method 3: Broadcast to all (for testing)
        io.emit("new_alert_broadcast", {
          ...alertData,
          broadcast: true,
          targetUser: clinician_id
        });
        console.log(`   ✅ Method 3: Broadcast to all`);

        notificationsSent++;
      } else {
        console.log(`   ❌ Clinician ${clinician_id} not connected`);
        
        // Debug: Get all sockets
        const allSockets = await io.fetchSockets();
        console.log(`   🔍 All connected sockets:`, allSockets.map(s => ({
          id: s.id,
          userId: s.userId,
          rooms: Array.from(s.rooms)
        })));
      }
    }

    // Get connected users AFTER processing
    const connectedUsersAfter = getConnectedUsers();
    console.log("📊 Connected users AFTER alert:", connectedUsersAfter);

    res.status(201).json({
      ok: true,
      message: `Alert created. Notifications sent to ${notificationsSent}/${dr_ids.length} clinicians`,
      alert: result.newAlert,
      patient: result.patientDetails,
      notifications_sent: notificationsSent,
      total_clinicians: dr_ids.length,
      connected_users_before: connectedUsersBefore,
      connected_users_after: connectedUsersAfter
    });
  } catch (error) {
    console.error("❌ Error creating alert:", error);
    res.status(500).json({ 
      ok: false, 
      message: "Server error", 
      error: error.message 
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

    // Verify all dr_ids exist and are clinicians
    const validClinicians = await knex("users")
      .select("users.id", "users.name", "users.email", "role.role_type")
      .join("role", "users.id", "role.user_id")
      .whereIn("users.id", dr_ids)
      .where("role.role_type", "clinician")
      .where("users.is_active", true);

    console.log("✅ Valid clinicians found:", validClinicians.length);
    console.log(
      "   Clinician details:",
      validClinicians.map((d) => ({
        id: d.id,
        name: d.name,
        role: d.role_type,
      }))
    );

    if (validClinicians.length !== dr_ids.length) {
      const foundClinicianIds = validClinicians.map((d) => d.id);
      const missingClinicians = dr_ids.filter(
        (id) => !foundClinicianIds.includes(id)
      );
      return res.status(400).json({
        ok: false,
        message: "One or more clinician IDs are invalid or not clinicians",
        missing_clinicians: missingClinicians,
        valid_clinicians: foundClinicianIds,
      });
    }

    // Get patient details for notification
    const patientDetails = await knex("users")
      .select("id", "name", "email", "phoneNumber", "organization_id")
      .where("id", patient_id)
      .first();

    console.log("👤 Patient details:", patientDetails);

    // Start transaction to ensure atomicity
    const result = await knex.transaction(async (trx) => {
      // Insert alert
      const [alertId] = await trx("alerts").insert({
        user_id: patient_id,
        desc: desc || `Health alert with severity: ${type}`,
        type,
      });

      console.log("📝 Alert inserted with ID:", alertId);

      // Insert assignments for each clinician
      const assignments = dr_ids.map((clinician_id) => ({
        alert_id: alertId,
        doctor_id: clinician_id,
        read_status: false,
        read_at: null,
      }));
      await trx("alert_assignments").insert(assignments);

      // Fetch the complete alert with patient details for response/notification
      const newAlert = await trx("alerts")
        .select(
          "alerts.*",
          "patients.name as patient_name",
          "patients.email as patient_email",
          "patients.phoneNumber as patient_phone",
          "patients.organization_id as patient_organization_id"
        )
        .leftJoin("users as patients", "alerts.user_id", "patients.id")
        .where("alerts.id", alertId)
        .first();

      return { alertId, newAlert, patientDetails };
    });

    // Send WebSocket notifications to all clinicians
    const io = getIO();
    console.log("📡 Sending WebSocket notifications to clinicians:", dr_ids);
    console.log(
      "📊 Currently connected sockets:",
      Array.from(userSockets.entries())
    );

    let notificationsSent = 0;

    // Send notifications to each clinician
    for (const clinician_id of dr_ids) {
      const clinicianSocketId = userSockets.get(clinician_id.toString());
      console.log(
        `   Checking clinician ${clinician_id} - socket:`,
        clinicianSocketId
      );

      if (clinicianSocketId) {
        // Get updated unread count for this clinician
        const unreadCount = await knex("alert_assignments")
          .where("doctor_id", clinician_id)
          .andWhere("read_status", false)
          .count("id as count")
          .first();

        // 🔥 CRITICAL: Emit to user's personal room
        io.to(`user_${clinician_id}`).emit("new_alert", {
          alert: {
            ...result.newAlert,
            read_status: false,
            assignment_id: clinician_id,
          },
          patient: {
            id: patientDetails.id,
            name: patientDetails.name,
            email: patientDetails.email,
            phoneNumber: patientDetails.phoneNumber,
            organization_id: patientDetails.organization_id,
          },
          unread_count: parseInt(unreadCount?.count) || 0,
          timestamp: new Date(),
        });

        console.log(
          `   ✅ Notification sent to clinician ${clinician_id} in room user_${clinician_id}`
        );
        notificationsSent++;
      } else {
        console.log(
          `   ❌ Clinician ${clinician_id} not connected - no active socket`
        );

        // Debug: Check all connected sockets
        const allSockets = await io.fetchSockets();
        console.log(
          `   🔍 All connected socket IDs:`,
          allSockets.map((s) => ({
            id: s.id,
            userId: s.userId,
          }))
        );
      }
    }

    res.status(201).json({
      ok: true,
      message: `Alert created. Notifications sent to ${notificationsSent}/${dr_ids.length} clinicians`,
      alert: result.newAlert,
      patient: result.patientDetails,
      notifications_sent: notificationsSent,
      total_clinicians: dr_ids.length,
      connected_users: Array.from(userSockets.entries()),
    });
  } catch (error) {
    console.error("❌ Error creating alert:", error);
    res.status(500).json({
      ok: false,
      message: "Server error",
      error: error.message,
    });
  }
});
// Original alert route (with auth)
router.post("/", authRequired, async (req, res) => {
  const { dr_ids, type, desc } = req.body;
  const patient_id = req.user.id;

  console.log("🚨 Alert creation request received:");
  console.log("   Patient ID:", patient_id);
  console.log("   Clinician IDs:", dr_ids);
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
    // Verify all dr_ids exist and are clinicians
    const validClinicians = await knex("users")
      .select("users.id", "users.name", "users.email", "role.role_type")
      .join("role", "users.id", "role.user_id")
      .whereIn("users.id", dr_ids)
      .where("role.role_type", "clinician")
      .where("users.is_active", true);

    console.log("✅ Valid clinicians found:", validClinicians.length);

    if (validClinicians.length !== dr_ids.length) {
      return res.status(400).json({
        ok: false,
        message: "One or more clinician IDs are invalid or not clinicians",
      });
    }

    // Get patient details for notification
    const patientDetails = await knex("users")
      .select("id", "name", "email", "phoneNumber", "organization_id")
      .where("id", patient_id)
      .first();

    console.log("👤 Patient details:", patientDetails);

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

      // Insert assignments for each clinician - UPDATED WITH READ STATUS
      const assignments = dr_ids.map((clinician_id) => ({
        alert_id: alertId,
        doctor_id: clinician_id,
        read_status: false,
        read_at: null,
      }));
      await trx("alert_assignments").insert(assignments);

      // Fetch the complete alert with patient details for response/notification
      const newAlert = await trx("alerts")
        .select(
          "alerts.*",
          "patients.name as patient_name",
          "patients.email as patient_email",
          "patients.phoneNumber as patient_phone",
          "patients.organization_id as patient_organization_id"
        )
        .leftJoin("users as patients", "alerts.user_id", "patients.id")
        .where("alerts.id", alertId)
        .first();

      return { alertId, newAlert, patientDetails };
    });

    // Send WebSocket notifications to all clinicians
    const io = getIO();
    console.log("📡 Sending WebSocket notifications to clinicians:", dr_ids);

    let notificationsSent = 0;

    // Send notifications to each clinician
    for (const clinician_id of dr_ids) {
      const clinicianSocketId = userSockets.get(clinician_id.toString());
      if (clinicianSocketId) {
        // Get updated unread count for this clinician
        const unreadCount = await knex("alert_assignments")
          .where("doctor_id", clinician_id)
          .andWhere("read_status", false)
          .count("id as count")
          .first();

        io.to(clinicianSocketId).emit("new_alert", {
          alert: {
            ...result.newAlert,
            read_status: false,
            assignment_id: clinician_id,
          },
          patient: {
            id: patientDetails.id,
            name: patientDetails.name,
            email: patientDetails.email,
            phoneNumber: patientDetails.phoneNumber,
            organization_id: patientDetails.organization_id,
          },
          unread_count: parseInt(unreadCount?.count) || 0,
          timestamp: new Date(),
        });
        console.log(`   ✅ Notification sent to clinician ${clinician_id}`);
        notificationsSent++;
      } else {
        console.log(
          `   ❌ Clinician ${clinician_id} not connected; alert saved but not notified in real-time`
        );
      }
    }

    res.status(201).json({
      ok: true,
      message: `Alert created. Notifications sent to ${notificationsSent}/${dr_ids.length} clinicians`,
      alert: result.newAlert,
      patient: result.patientDetails,
    });
  } catch (error) {
    console.error("Error creating alert:", error);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});
// Get unread alerts count for notification badge
router.get("/unread-count", authRequired, async (req, res) => {
  const clinician_id = req.user.id;

  try {
    // Verify the user is a clinician
    const clinicianRole = await knex("role")
      .where("user_id", clinician_id)
      .andWhere("role_type", "clinician")
      .first();

    if (!clinicianRole) {
      return res.status(403).json({
        ok: false,
        message: "Access denied. User is not a clinician",
      });
    }

    const unreadCount = await knex("alert_assignments")
      .where("doctor_id", clinician_id)
      .andWhere("read_status", false)
      .count("id as count")
      .first();

    res.json({
      ok: true,
      unread_count: parseInt(unreadCount?.count) || 0,
    });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    res
      .status(500)
      .json({ ok: false, message: "Server error", error: error.message });
  }
});
// Get all alerts for a clinician (with read status)
router.get("/my-alerts", authRequired, async (req, res) => {
  const clinician_id = req.user.id;

  try {
    // Verify the user is a clinician
    const clinicianRole = await knex("role")
      .where("user_id", clinician_id)
      .andWhere("role_type", "clinician")
      .first();

    if (!clinicianRole) {
      return res.status(403).json({
        ok: false,
        message: "Access denied. User is not a clinician",
      });
    }

    const alerts = await knex("alert_assignments")
      .select(
        "alerts.id",
        "alerts.user_id as patient_id",
        "alerts.desc",
        "alerts.type",
        "alerts.created_at as alert_created_at",
        "alerts.updated_at as alert_updated_at",
        "alert_assignments.read_status",
        "alert_assignments.read_at",
        "alert_assignments.created_at as assigned_at",
        "alert_assignments.id as assignment_id",
        "patients.name as patient_name",
        "patients.email as patient_email",
        "patients.phoneNumber as patient_phone",
        "patients.organization_id as patient_organization_id"
      )
      .join("alerts", "alert_assignments.alert_id", "alerts.id")
      .join("users as patients", "alerts.user_id", "patients.id")
      .where("alert_assignments.doctor_id", clinician_id)
      .orderBy("alerts.created_at", "desc");

    // Count unread alerts
    const unreadCount = await knex("alert_assignments")
      .where("doctor_id", clinician_id)
      .andWhere("read_status", false)
      .count("id as count")
      .first();

    res.json({
      ok: true,
      alerts,
      unread_count: parseInt(unreadCount?.count) || 0,
      total_alerts: alerts.length,
    });
  } catch (error) {
    console.error("Error fetching alerts:", error);
    res
      .status(500)
      .json({ ok: false, message: "Server error", error: error.message });
  }
});
// Get only unread alerts for a clinician
router.get("/my-alerts/unread", authRequired, async (req, res) => {
  const clinician_id = req.user.id;

  try {
    // Verify the user is a clinician
    const clinicianRole = await knex("role")
      .where("user_id", clinician_id)
      .andWhere("role_type", "clinician")
      .first();

    if (!clinicianRole) {
      return res.status(403).json({
        ok: false,
        message: "Access denied. User is not a clinician",
      });
    }

    const unreadAlerts = await knex("alert_assignments")
      .select(
        "alerts.id",
        "alerts.user_id as patient_id",
        "alerts.desc",
        "alerts.type",
        "alerts.created_at as alert_created_at",
        "alerts.updated_at as alert_updated_at",
        "alert_assignments.read_status",
        "alert_assignments.read_at",
        "alert_assignments.created_at as assigned_at",
        "alert_assignments.id as assignment_id",
        "patients.name as patient_name",
        "patients.email as patient_email",
        "patients.phoneNumber as patient_phone",
        "patients.organization_id as patient_organization_id"
      )
      .join("alerts", "alert_assignments.alert_id", "alerts.id")
      .join("users as patients", "alerts.user_id", "patients.id")
      .where("alert_assignments.doctor_id", clinician_id)
      .andWhere("alert_assignments.read_status", false)
      .orderBy("alerts.created_at", "desc");

    res.json({
      ok: true,
      alerts: unreadAlerts,
      count: unreadAlerts.length,
    });
  } catch (error) {
    console.error("Error fetching unread alerts:", error);
    res
      .status(500)
      .json({ ok: false, message: "Server error", error: error.message });
  }
});
// Mark a specific alert as read
router.patch("/:alert_id/read", authRequired, async (req, res) => {
  const clinician_id = req.user.id;
  const { alert_id } = req.params;

  try {
    // Verify the alert assignment exists and belongs to this clinician
    const assignment = await knex("alert_assignments")
      .where("alert_id", alert_id)
      .andWhere("doctor_id", clinician_id)
      .first();

    if (!assignment) {
      return res.status(404).json({
        ok: false,
        message: "Alert not found or you don't have permission to access it",
      });
    }

    // If already read, return success
    if (assignment.read_status) {
      return res.json({
        ok: true,
        message: "Alert is already marked as read",
      });
    }

    // Mark as read
    await knex("alert_assignments")
      .where("alert_id", alert_id)
      .andWhere("doctor_id", clinician_id)
      .update({
        read_status: true,
        read_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });

    // Get updated unread count
    const unreadCount = await knex("alert_assignments")
      .where("doctor_id", clinician_id)
      .andWhere("read_status", false)
      .count("id as count")
      .first();

    // Send WebSocket update for real-time badge update
    const io = getIO();
    const clinicianSocketId = userSockets.get(clinician_id.toString());
    if (clinicianSocketId) {
      io.to(clinicianSocketId).emit("alert_read", {
        alert_id: alert_id,
        unread_count: parseInt(unreadCount?.count) || 0,
      });
    }

    res.json({
      ok: true,
      message: "Alert marked as read successfully",
      unread_count: parseInt(unreadCount?.count) || 0,
    });
  } catch (error) {
    console.error("Error marking alert as read:", error);
    res
      .status(500)
      .json({ ok: false, message: "Server error", error: error.message });
  }
});
// Mark all alerts as read for a clinician
router.patch("/mark-all-read", authRequired, async (req, res) => {
  const clinician_id = req.user.id;

  try {
    // Count unread alerts before update
    const unreadCount = await knex("alert_assignments")
      .where("doctor_id", clinician_id)
      .andWhere("read_status", false)
      .count("id as count")
      .first();

    const countToUpdate = parseInt(unreadCount?.count) || 0;

    if (countToUpdate === 0) {
      return res.json({
        ok: true,
        message: "No unread alerts to mark as read",
        updated_count: 0,
      });
    }

    // Mark all unread alerts as read
    const updatedCount = await knex("alert_assignments")
      .where("doctor_id", clinician_id)
      .andWhere("read_status", false)
      .update({
        read_status: true,
        read_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });

    // Get updated unread count (should be 0)
    const newUnreadCount = await knex("alert_assignments")
      .where("doctor_id", clinician_id)
      .andWhere("read_status", false)
      .count("id as count")
      .first();

    // Send WebSocket update
    const io = getIO();
    const clinicianSocketId = userSockets.get(clinician_id.toString());
    if (clinicianSocketId) {
      io.to(clinicianSocketId).emit("all_alerts_read", {
        unread_count: 0,
      });
    }

    res.json({
      ok: true,
      message: `Successfully marked ${updatedCount} alerts as read`,
      updated_count: updatedCount,
      unread_count: 0,
    });
  } catch (error) {
    console.error("Error marking all alerts as read:", error);
    res
      .status(500)
      .json({ ok: false, message: "Server error", error: error.message });
  }
});
module.exports = router;
