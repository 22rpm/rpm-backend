// controllers/messageController.js
const messageService = require("../services/messageService");
const notificationService = require("../services/notificationService");
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

      // Notify the patient's assigned physician (email/SMS). Fire-and-forget: it is
      // debounced + fully logged and must never block or fail the message send. Only
      // fires when the sender is a patient.
      notificationService.notifyOnPatientMessage(senderId, receiverId).catch(() => {});

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
      console.log("message ctx user:", req.user?.id ?? "none"); // REDACTED: id only
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
      console.log("getPatients called by user:", req.user?.id ?? "none"); // REDACTED: id only

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

  // Clinician inbox — assignment + active gated conversations, newest first.
  async getClinicianInbox(req, res) {
    try {
      const inbox = await messageService.getClinicianInbox(req.user.id);
      res.json({ success: true, data: inbox });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to get inbox", error: error.message });
    }
  }

  // Total unread for the nav badge (DB-backed; survives reload).
  async getUnreadCount(req, res) {
    try {
      const count = await messageService.getClinicianUnreadCount(req.user.id);
      res.json({ success: true, count });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to get unread count", error: error.message });
    }
  }

  // Physician notification preferences (default ON for both channels).
  async getNotificationPrefs(req, res) {
    try {
      res.json({ success: true, data: await notificationService.getPrefs(req.user.id) });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  }
  async updateNotificationPrefs(req, res) {
    try {
      const { message_email, message_sms } = req.body;
      const data = await notificationService.setPrefs(req.user.id, { message_email, message_sms });
      res.json({ success: true, data });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  // Dashboard failure indicator: recent failed/undelivered/unroutable notifications.
  async getNotificationFailures(req, res) {
    try {
      const [data, count] = await Promise.all([
        notificationService.getRecentFailures({}),
        notificationService.getFailureCount({}),
      ]);
      res.json({ success: true, count, data });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  // Public Twilio StatusCallback: flips accepted -> delivered/undelivered by SID so an
  // async SMS bounce (valid-but-wrong number) surfaces, not just synchronous errors.
  async twilioStatusCallback(req, res) {
    try {
      const sid = req.body.MessageSid || req.body.SmsSid;
      const status = req.body.MessageStatus || req.body.SmsStatus;
      await notificationService.updateDeliveryByProviderRef(sid, status);
      res.status(204).end();
    } catch (e) {
      res.status(200).end(); // never make Twilio retry on our error
    }
  }
}

module.exports = new MessageController();
