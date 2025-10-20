// controllers/messageController.js
const messageService = require("../services/messageService");
const { getIO } = require("../socket/socketServer");

class MessageController {
  async sendMessage(req, res) {
    try {
      const { receiverId, message } = req.body;
      const senderId = req.user.id; // From JWT middleware
      console.log("sendMessage called with:", {
        senderId,
        receiverId,
        message,
      });

      const savedMessage = await messageService.saveMessage(
        senderId,
        receiverId,
        message
      );

      // Emit through socket
      const io = getIO();
      const roomId = [senderId, receiverId].sort().join("_");
      io.to(roomId).emit("new_message", {
        ...savedMessage,
        senderId,
        receiverId,
      });

      res.status(201).json({
        success: true,
        message: "Message sent successfully",
        data: savedMessage,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to send message",
        error: error.message,
      });
    }
  }

  async getConversation(req, res) {
    try {
      const { userId } = req.params;
      const currentUserId = req.user.id;
      const limit = req.query.limit || 50;

      const messages = await messageService.getConversation(
        currentUserId,
        parseInt(userId),
        limit
      );

      // Mark messages as read
      await messageService.markAsRead(currentUserId, parseInt(userId));

      res.json({
        success: true,
        data: messages.reverse(), // Show oldest first
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to get conversation",
        error: error.message,
      });
    }
  }

  async getUserConversations(req, res) {
    try {
      console.log(req.user);
      const userId = req.user.id;
      console.log("Fetching conversations for userId:", userId);
      const conversations = await messageService.getUserConversations(userId);

      res.json({
        success: true,
        data: conversations,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to get conversations",
        error: error.message,
      });
    }
  }

  async getClinicians(req, res) {
    try {
      const clinicians = await messageService.getCliniciansByPatient(
        req.user.id
      );

      res.json({
        success: true,
        data: clinicians,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to get clinicians",
        error: error.message,
      });
    }
  }

  async getPatients(req, res) {
    try {
      console.log("getPatients called", req.user);

      // Get doctor ID from the authenticated user
      const doctorId = req.user.id;

      const patients = await messageService.getPatients(doctorId);

      // Process health data and add status
      const processedPatients = patients.map((patient) => {
        let status = "No Data";
        let heartRate = "--";
        let lastReading = "No readings yet";

        if (patient.latest_bp_data) {
          const bpData = patient.latest_bp_data;

          // Extract heart rate (pulse) from BP data
          heartRate = bpData.pulse || bpData.heartRate || "--";

          // Format last reading time
          lastReading = patient.last_reading_time
            ? new Date(patient.last_reading_time).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "No readings yet";

          // Determine status based on BP values
          const systolic = bpData.systolic || 0;
          const diastolic = bpData.diastolic || 0;

          if (systolic === 0 && diastolic === 0) {
            status = "No Data";
          } else if (systolic < 120 && diastolic < 80) {
            status = "Normal";
          } else if (systolic <= 139 && diastolic <= 89) {
            status = "Warning";
          } else {
            status = "Critical";
          }

          // If we have pulse data, also consider it for status
          if (heartRate !== "--") {
            const pulse = parseInt(heartRate);
            if (pulse < 50 || pulse > 100) {
              status = "Critical";
            } else if (pulse > 90) {
              status = status === "Normal" ? "Warning" : status;
            }
          }
        }

        return {
          id: patient.id,
          name: patient.name,
          email: patient.email,
          status,
          heartRate: heartRate === "--" ? "--" : `${heartRate} BPM`,
          lastReading,
          rawData: patient.latest_bp_data, // optional: include for debugging
        };
      });

      res.json({
        success: true,
        data: processedPatients,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to get patients",
        error: error.message,
      });
    }
  }
}

module.exports = new MessageController();
