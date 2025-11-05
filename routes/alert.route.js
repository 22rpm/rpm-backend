const express = require("express");
const jwt = require("jsonwebtoken");
const knex = require("../config/db");
const { authRequired } = require("../middleware/auth");

const {
  userSockets,
  getIO,
  getConnectedUsers,
  isUserConnected,
  getUserSocketId,
} = require("../socket/socketServer");

const router = express.Router();
// ✅ Helper to calculate BP status
const calculateBPStatus = (systolic, diastolic) => {
  const sys = parseInt(systolic);
  const dia = parseInt(diastolic);

  if (sys < 90 || dia < 60) return "Low";
  else if (sys <= 120 && dia <= 80) return "Normal";
  else if (sys > 120 || dia > 80) return "High";
  else return "Normal";
};
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

// TEMPORARY TEST ROUTE - Remove this after testing
// routes/alert.route.js - COMPLETE FIXED VERSION
router.post("/test-alert", async (req, res) => {
  const { dr_ids, type, desc, patient_id = 21 } = req.body;

  console.log("=".repeat(60));
  console.log("🚨 TEST ALERT CREATION REQUEST");
  console.log("=".repeat(60));
  console.log("   Patient ID:", patient_id);
  console.log("   Doctor IDs:", dr_ids);
  console.log("   Alert Type:", type);
  console.log("   Description:", desc);

  // Validate input
  if (!dr_ids || !Array.isArray(dr_ids) || dr_ids.length === 0 || !type) {
    return res.status(400).json({
      ok: false,
      message: "Invalid request: dr_ids (non-empty array) and type required",
    });
  }

  try {
    // Get connection status BEFORE processing
    const connectedUsersBefore = getConnectedUsers();
    console.log("📊 Connected users BEFORE alert:", connectedUsersBefore);

    // Verify clinicians exist and are active
    const validClinicians = await knex("users")
      .select("users.id", "users.name", "users.email", "role.role_type")
      .join("role", "users.id", "role.user_id")
      .whereIn("users.id", dr_ids)
      .where("role.role_type", "clinician")
      .where("users.is_active", true);

    console.log("✅ Valid clinicians found:", validClinicians.length);

    if (validClinicians.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "No valid clinicians found from the provided IDs",
      });
    }

    // Get patient details
    const patientDetails = await knex("users")
      .select("id", "name", "email", "phoneNumber", "organization_id")
      .where("id", patient_id)
      .first();

    if (!patientDetails) {
      return res.status(400).json({
        ok: false,
        message: "Patient not found",
      });
    }

    console.log("👤 Patient details:", patientDetails);

    // Start transaction
    const transactionResult = await knex.transaction(async (trx) => {
      // Insert alert
      const [alertId] = await trx("alerts").insert({
        user_id: patient_id,
        desc: desc || `Health alert with severity: ${type}`,
        type: type,
        created_at: new Date(),
      });

      console.log("📝 Alert inserted with ID:", alertId);

      // ✅ FIXED: Use correct column names for alert_assignments
      const assignments = dr_ids.map((clinician_id) => ({
        alert_id: alertId,
        doctor_id: clinician_id,
        read_status: false,
        read_at: null,
        created_at: new Date(), // ✅ Use created_at instead of assigned_at
        updated_at: new Date(), // ✅ Add updated_at
      }));

      await trx("alert_assignments").insert(assignments);
      console.log("✅ Alert assignments created for clinicians:", dr_ids);

      // Fetch complete alert details
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

    // Send WebSocket notifications
    const io = getIO();
    console.log("📡 Sending WebSocket notifications to clinicians:", dr_ids);

    let notificationsSent = 0;
    const notificationResults = [];

    for (const clinician_id of dr_ids) {
      const clinicianSocketId = getUserSocketId(clinician_id);
      const isConnected = isUserConnected(clinician_id);

      console.log(`   👨‍⚕️ Clinician ${clinician_id}:`, {
        socketId: clinicianSocketId,
        isConnected: isConnected,
        inUserSockets: userSockets.has(clinician_id.toString()),
      });

      // Get unread count
      const unreadCount = await knex("alert_assignments")
        .where("doctor_id", clinician_id)
        .andWhere("read_status", false)
        .count("id as count")
        .first();

      const alertData = {
        alert: {
          ...transactionResult.newAlert,
          read_status: false,
          assignment_id: clinician_id,
        },
        patient: patientDetails,
        unread_count: parseInt(unreadCount?.count) || 0,
        timestamp: new Date(),
        server_time: new Date().toISOString(),
      };

      let sent = false;

      // Try multiple methods to send alert
      if (isConnected && clinicianSocketId) {
        // Method 1: Send to user's personal room
        io.to(`user_${clinician_id}`).emit("new_alert", alertData);
        console.log(`   ✅ Method 1: Sent to room user_${clinician_id}`);
        sent = true;

        // Method 2: Send to specific socket
        io.to(clinicianSocketId).emit("new_alert", alertData);
        console.log(`   ✅ Method 2: Sent to socket ${clinicianSocketId}`);
      }

      // Method 3: Broadcast to all clinicians room (fallback)
      io.to("all_clinicians").emit("new_alert_broadcast", {
        ...alertData,
        broadcast: true,
        intended_for: clinician_id,
      });
      console.log(`   ✅ Method 3: Broadcast to all_clinicians room`);

      if (sent) {
        notificationsSent++;
      }

      notificationResults.push({
        clinician_id,
        connected: isConnected,
        socket_id: clinicianSocketId,
        notification_sent: sent,
      });
    }

    // Get connection status AFTER processing
    const connectedUsersAfter = getConnectedUsers();
    console.log("📊 Connected users AFTER alert:", connectedUsersAfter);

    res.status(201).json({
      ok: true,
      message: `Alert created successfully. Notifications sent to ${notificationsSent}/${dr_ids.length} clinicians`,
      alert: transactionResult.newAlert,
      patient: patientDetails,
      notifications: {
        sent: notificationsSent,
        total: dr_ids.length,
        details: notificationResults,
      },
      connection_info: {
        before: connectedUsersBefore,
        after: connectedUsersAfter,
        total_connections: connectedUsersAfter.length,
      },
    });
  } catch (error) {
    console.error("❌ Error creating alert:", error);
    res.status(500).json({
      ok: false,
      message: "Server error creating alert",
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// New endpoint to check socket connections
router.get("/connection-status", (req, res) => {
  const connectedUsers = getConnectedUsers();

  res.json({
    ok: true,
    connected_users: connectedUsers,
    total_connections: connectedUsers.length,
    timestamp: new Date().toISOString(),
  });
});
// router.post("/test-alert", async (req, res) => {
//   const { dr_ids, type, desc, patient_id = 21 } = req.body;

//   console.log("=".repeat(60));
//   console.log("🚨 TEST ALERT CREATION REQUEST");
//   console.log("=".repeat(60));
//   console.log("   Patient ID:", patient_id);
//   console.log("   Doctor IDs:", dr_ids);
//   console.log("   Alert Type:", type);
//   console.log("   Description:", desc);

//   // Validate input
//   if (!dr_ids || !Array.isArray(dr_ids) || dr_ids.length === 0 || !type) {
//     return res.status(400).json({
//       ok: false,
//       message: "Invalid request: dr_ids (non-empty array) and type required",
//     });
//   }

//   try {
//     // Get connection status BEFORE processing
//     const connectedUsersBefore = getConnectedUsers();
//     console.log("📊 Connected users BEFORE alert:", connectedUsersBefore);

//     // Verify clinicians exist and are active
//     const validClinicians = await knex("users")
//       .select("users.id", "users.name", "users.email", "role.role_type")
//       .join("role", "users.id", "role.user_id")
//       .whereIn("users.id", dr_ids)
//       .where("role.role_type", "clinician")
//       .where("users.is_active", true);

//     console.log("✅ Valid clinicians found:", validClinicians.length);

//     if (validClinicians.length === 0) {
//       return res.status(400).json({
//         ok: false,
//         message: "No valid clinicians found from the provided IDs",
//       });
//     }

//     // Get patient details
//     const patientDetails = await knex("users")
//       .select("id", "name", "email", "phoneNumber", "organization_id")
//       .where("id", patient_id)
//       .first();

//     if (!patientDetails) {
//       return res.status(400).json({
//         ok: false,
//         message: "Patient not found",
//       });
//     }

//     console.log("👤 Patient details:", patientDetails);

//     // Start transaction
//     const transactionResult = await knex.transaction(async (trx) => {
//       // Insert alert
//       const [alertId] = await trx("alerts").insert({
//         user_id: patient_id,
//         desc: desc || `Health alert with severity: ${type}`,
//         type: type,
//         created_at: new Date(),
//       });

//       console.log("📝 Alert inserted with ID:", alertId);

//       // Insert assignments
//       const assignments = dr_ids.map((clinician_id) => ({
//         alert_id: alertId,
//         doctor_id: clinician_id,
//         read_status: false,
//         read_at: null,
//         assigned_at: new Date(),
//       }));

//       await trx("alert_assignments").insert(assignments);

//       // Fetch complete alert details
//       const newAlert = await trx("alerts")
//         .select(
//           "alerts.*",
//           "patients.name as patient_name",
//           "patients.email as patient_email",
//           "patients.phoneNumber as patient_phone",
//           "patients.organization_id as patient_organization_id"
//         )
//         .leftJoin("users as patients", "alerts.user_id", "patients.id")
//         .where("alerts.id", alertId)
//         .first();

//       return { alertId, newAlert, patientDetails };
//     });

//     // Send WebSocket notifications
//     const io = getIO();
//     console.log("📡 Sending WebSocket notifications to clinicians:", dr_ids);

//     let notificationsSent = 0;
//     const notificationResults = [];

//     for (const clinician_id of dr_ids) {
//       const clinicianSocketId = getUserSocketId(clinician_id);
//       const isConnected = isUserConnected(clinician_id);

//       console.log(`   👨‍⚕️ Clinician ${clinician_id}:`, {
//         socketId: clinicianSocketId,
//         isConnected: isConnected,
//         inUserSockets: userSockets.has(clinician_id.toString()),
//       });

//       // Get unread count
//       const unreadCount = await knex("alert_assignments")
//         .where("doctor_id", clinician_id)
//         .andWhere("read_status", false)
//         .count("id as count")
//         .first();

//       const alertData = {
//         alert: {
//           ...transactionResult.newAlert,
//           read_status: false,
//           assignment_id: clinician_id,
//         },
//         patient: patientDetails,
//         unread_count: parseInt(unreadCount?.count) || 0,
//         timestamp: new Date(),
//         server_time: new Date().toISOString(),
//       };

//       let sent = false;

//       // Try multiple methods to send alert
//       if (isConnected && clinicianSocketId) {
//         // Method 1: Send to user's personal room
//         io.to(`user_${clinician_id}`).emit("new_alert", alertData);
//         console.log(`   ✅ Method 1: Sent to room user_${clinician_id}`);
//         sent = true;

//         // Method 2: Send to specific socket
//         io.to(clinicianSocketId).emit("new_alert", alertData);
//         console.log(`   ✅ Method 2: Sent to socket ${clinicianSocketId}`);
//       }

//       // Method 3: Broadcast to all clinicians room (fallback)
//       io.to("all_clinicians").emit("new_alert_broadcast", {
//         ...alertData,
//         broadcast: true,
//         intended_for: clinician_id,
//       });
//       console.log(`   ✅ Method 3: Broadcast to all_clinicians room`);

//       if (sent) {
//         notificationsSent++;
//       }

//       notificationResults.push({
//         clinician_id,
//         connected: isConnected,
//         socket_id: clinicianSocketId,
//         notification_sent: sent,
//       });
//     }

//     // Get connection status AFTER processing
//     const connectedUsersAfter = getConnectedUsers();
//     console.log("📊 Connected users AFTER alert:", connectedUsersAfter);

//     res.status(201).json({
//       ok: true,
//       message: `Alert created successfully. Notifications sent to ${notificationsSent}/${dr_ids.length} clinicians`,
//       alert: transactionResult.newAlert,
//       patient: patientDetails,
//       notifications: {
//         sent: notificationsSent,
//         total: dr_ids.length,
//         details: notificationResults,
//       },
//       connection_info: {
//         before: connectedUsersBefore,
//         after: connectedUsersAfter,
//         total_connections: connectedUsersAfter.length,
//       },
//     });
//   } catch (error) {
//     console.error("❌ Error creating alert:", error);
//     res.status(500).json({
//       ok: false,
//       message: "Server error creating alert",
//       error: error.message,
//     });
//   }
// });

// New endpoint to check socket connections
router.get("/connection-status", (req, res) => {
  const connectedUsers = getConnectedUsers();

  res.json({
    ok: true,
    connected_users: connectedUsers,
    total_connections: connectedUsers.length,
    timestamp: new Date().toISOString(),
  });
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

router.get("/alert-settings", authRequired, async (req, res) => {
  console.log("getting the alert settings");
  try {
    const doctor_id = req.user.id;

    // Check if user is a doctor/clinician - USING YOUR MYSQL CONNECTION
    const [roleRows] = await knex.query(
      "SELECT role_type FROM role WHERE user_id = ?",
      [doctor_id]
    );

    const role = roleRows[0]; // Get the first row
    console.log("getting the dr setting .. dr role", role);

    if (!role || !["doctor", "clinician"].includes(role.role_type)) {
      console.log("no role or invalid role");
      return res.status(403).json({
        success: false,
        message: "Access denied. Doctor role required.",
      });
    }

    // Get doctor's settings - USING YOUR MYSQL CONNECTION
    const [settingsRows] = await knex.query(
      "SELECT * FROM doctor_alert_settings WHERE doctor_id = ?",
      [doctor_id]
    );

    // If no settings exist, return defaults
    if (!settingsRows || settingsRows.length === 0) {
      const defaultSettings = {
        systolic_high: 140,
        systolic_low: 90,
        diastolic_high: 90,
        diastolic_low: 60,
      };
      return res.json({
        success: true,
        settings: defaultSettings,
        isDefault: true,
      });
    }

    const settings = settingsRows[0];
    res.json({
      success: true,
      settings: settings,
      isDefault: false,
    });
  } catch (error) {
    console.error("Error fetching doctor alert settings:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});
router.patch("/alert-settings", authRequired, async (req, res) => {
  try {
    const doctor_id = req.user.id;
    const { systolic_high, systolic_low, diastolic_high, diastolic_low } =
      req.body;

    // Validate doctor role
    const [roleRows] = await knex.query(
      "SELECT role_type FROM role WHERE user_id = ?",
      [doctor_id]
    );

    const role = roleRows[0];
    if (!role || !["doctor", "clinician"].includes(role.role_type)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Doctor role required.",
      });
    }

    // Validate input
    const errors = [];

    if (systolic_high && (systolic_high < 100 || systolic_high > 200)) {
      errors.push("Systolic high must be between 100 and 200");
    }

    if (systolic_low && (systolic_low < 60 || systolic_low > 150)) {
      errors.push("Systolic low must be between 60 and 150");
    }

    if (diastolic_high && (diastolic_high < 60 || diastolic_high > 130)) {
      errors.push("Diastolic high must be between 60 and 130");
    }

    if (diastolic_low && (diastolic_low < 40 || diastolic_low > 100)) {
      errors.push("Diastolic low must be between 40 and 100");
    }

    if (systolic_high && systolic_low && systolic_high <= systolic_low) {
      errors.push("Systolic high must be greater than systolic low");
    }

    if (diastolic_high && diastolic_low && diastolic_high <= diastolic_low) {
      errors.push("Diastolic high must be greater than diastolic low");
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors,
      });
    }

    // Check if settings already exist
    const [existingSettings] = await knex.query(
      "SELECT id FROM doctor_alert_settings WHERE doctor_id = ?",
      [doctor_id]
    );

    let result;

    if (existingSettings && existingSettings.length > 0) {
      // Update existing settings
      [result] = await knex.query(
        `UPDATE doctor_alert_settings 
         SET systolic_high = ?, systolic_low = ?, diastolic_high = ?, diastolic_low = ?, updated_at = NOW()
         WHERE doctor_id = ?`,
        [systolic_high, systolic_low, diastolic_high, diastolic_low, doctor_id]
      );
    } else {
      // Insert new settings
      [result] = await knex.query(
        `INSERT INTO doctor_alert_settings 
         (doctor_id, systolic_high, systolic_low, diastolic_high, diastolic_low) 
         VALUES (?, ?, ?, ?, ?)`,
        [doctor_id, systolic_high, systolic_low, diastolic_high, diastolic_low]
      );
    }

    // Get updated settings
    const [updatedSettings] = await knex.query(
      "SELECT * FROM doctor_alert_settings WHERE doctor_id = ?",
      [doctor_id]
    );

    res.json({
      success: true,
      message:
        existingSettings && existingSettings.length > 0
          ? "Settings updated successfully"
          : "Settings created successfully",
      settings: updatedSettings[0],
    });
  } catch (error) {
    console.error("Error updating doctor alert settings:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

router.post("/test/bp-alert", async (req, res) => {
  console.log("📥 Incoming test request to /test/bp-alert");

  const { patient_id, devId, devType, systolic, diastolic, data } = req.body;

  console.log("📦 Request Body:", req.body);

  if (!patient_id || !devType || !systolic || !diastolic) {
    return res.status(400).json({
      success: false,
      message:
        "Missing required fields: patient_id, devType, systolic, diastolic are required",
    });
  }

  const bpStatus = calculateBPStatus(systolic, diastolic);
  console.log(`🩺 Calculated BP Status: ${bpStatus}`);

  // Only trigger BP alert for abnormal readings
  if (devType !== "bp" || bpStatus === "Normal") {
    return res.status(200).json({
      success: true,
      message: `BP status is ${bpStatus}. No alert triggered.`,
    });
  }

  console.log("🚨 BP Alert Condition Met:", bpStatus);

  let connection;
  try {
    connection = await db.getConnection();

    // 1️⃣ Get doctors assigned to the patient
    const [assignedDoctors] = await connection.query(
      "SELECT doctor_id FROM patient_doctor_assignments WHERE patient_id = ?",
      [patient_id]
    );

    if (!assignedDoctors.length) {
      console.log("⚠️ No doctors assigned to patient");
      return res.json({ ok: false, message: "No doctors assigned to patient" });
    }

    const doctor_ids = assignedDoctors.map((d) => d.doctor_id);
    console.log("👨‍⚕️ Assigned Doctor IDs:", doctor_ids);

    // 2️⃣ Validate doctors
    const [validDoctors] = await connection.query(
      `SELECT users.id, users.name, users.email, role.role_type
       FROM users
       JOIN role ON users.id = role.user_id
       WHERE users.id IN (?) 
       AND role.role_type IN ('clinician', 'doctor') 
       AND users.is_active = true`,
      [doctor_ids]
    );

    if (!validDoctors.length) {
      console.log("❌ No valid doctors found");
      return res.json({ ok: false, message: "No valid doctors found" });
    }

    // 3️⃣ Get patient details
    const [patientRows] = await connection.query(
      "SELECT id, name, email, phoneNumber, organization_id FROM users WHERE id = ?",
      [patient_id]
    );
    const patientDetails = patientRows[0];

    if (!patientDetails) {
      return res.json({ ok: false, message: "Patient not found" });
    }

    console.log("👤 Patient details:", patientDetails.name);

    // 4️⃣ Create alert + assignments in a transaction
    await connection.beginTransaction();

    const alertType = `BP_${bpStatus.toUpperCase()}`;
    const alertDesc = `Blood Pressure Alert: ${bpStatus} (${systolic}/${diastolic} mmHg)`;

    const [alertResult] = await connection.query(
      "INSERT INTO alerts (user_id, `desc`, type, created_at) VALUES (?, ?, ?, ?)",
      [patient_id, alertDesc, alertType, new Date()]
    );

    const alertId = alertResult.insertId;
    console.log("📝 Alert created with ID:", alertId);

    // Insert assignments for each doctor
    const assignmentValues = doctor_ids.map((doctor_id) => [
      alertId,
      doctor_id,
      false,
      null,
      new Date(),
      new Date(),
    ]);

    await connection.query(
      `INSERT INTO alert_assignments 
       (alert_id, doctor_id, read_status, read_at, created_at, updated_at) 
       VALUES ?`,
      [assignmentValues]
    );

    await connection.commit();

    console.log("✅ Alert and assignments created successfully.");

    // 5️⃣ Send notifications via WebSocket
    const io = getIO();
    const notifications = [];

    for (const doctor_id of doctor_ids) {
      const socketId = getUserSocketId(doctor_id);
      const connected = isUserConnected(doctor_id);

      const alertData = {
        alert_id: alertId,
        patient: patientDetails,
        bp_reading: `${systolic}/${diastolic}`,
        bp_status: bpStatus,
        timestamp: new Date(),
      };

      if (connected && socketId) {
        io.to(`user_${doctor_id}`).emit("new_alert", alertData);
        io.to(socketId).emit("new_alert", alertData);
        console.log(`📡 Alert sent to doctor ${doctor_id}`);
      }

      io.to("all_clinicians").emit("new_alert_broadcast", alertData);
      notifications.push({ doctor_id, connected });
    }

    res.status(201).json({
      success: true,
      message: "BP Alert triggered successfully",
      bpStatus,
      alertId,
      doctors: doctor_ids,
      notifications,
    });
  } catch (err) {
    console.error("❌ Error in /test/bp-alert:", err);
    if (connection) await connection.rollback();
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
