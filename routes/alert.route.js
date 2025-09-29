const express = require("express");
const jwt = require("jsonwebtoken"); // For auth middleware
const knex = require("../config/knex"); // Adjust path if your Knex config is elsewhere (e.g., a db.js file)
const { authRequired } = require("../middleware/auth");

const router = express.Router();


// POST /api/alerts - Create alert and notify doctor
router.post("/", authRequired, async (req, res) => {
  const { dr_ids, type, desc } = req.body; // dr_ids: array of doctor IDs
  const patient_id = req.user.id; // From authenticated patient

  // Validate input
  if (
    !dr_ids ||
    !Array.isArray(dr_ids) ||
    dr_ids.length === 0 ||
    !type ||
    !["high", "medium", "low"].includes(type)
  ) {
    return res
      .status(400)
      .json({
        ok: false,
        message:
          "Invalid request: dr_ids (non-empty array) and valid type required",
      });
  }

  try {
    // Verify all dr_ids exist and are doctors (assuming a 'role' column in users table)
    const validDoctors = await knex("users")
      .whereIn("id", dr_ids)
      .where("role", "doctor"); // Adjust 'role' column name if different
    if (validDoctors.length !== dr_ids.length) {
      return res
        .status(400)
        .json({
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
    dr_ids.forEach((doctor_id) => {
      const doctorSocketId = userSockets.get(doctor_id.toString()); // Ensure string ID for socket map
      if (doctorSocketId) {
        io.to(doctorSocketId).emit("new_alert", {
          alert: result.newAlert,
          patient_id,
          timestamp: new Date(),
        });
      } else {
        console.log(
          `Doctor ${doctor_id} not connected; alert saved but not notified in real-time`
        );
      }
    });

    res
      .status(201)
      .json({
        ok: true,
        message: "Alert created and doctors notified",
        alert: result.newAlert,
      });
  } catch (error) {
    console.error("Error creating alert:", error);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});


module.exports = router;
