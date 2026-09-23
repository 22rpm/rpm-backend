// controllers/messageController.js
const messageService = require("../services/messageService");
const staffMessages = require("../services/staffMessages.service");
const notif = require("../services/notification.service");
const audit = require("../services/audit.service");
const { getIO } = require("../socket/socketServer");

class MessageController {
  // ---- STAFF: the care-team-shared Messages inbox (CLINICIAN_SMS_DESIGN Phase 1) ----
  // All three require the STAFF role gate + resolveOrgScope (see messageRoutes).

  // GET /api/messages/inbox — patient conversations in scope, unread-first.
  async getInbox(req, res) {
    try {
      const rows = await staffMessages.getInbox(req.user, req.orgScope);
      res.json({ success: true, data: rows });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to load inbox", error: error.message });
    }
  }

  // GET /api/messages/unread-count — shared inbound unread total for the nav badge.
  async getUnreadCount(req, res) {
    try {
      const count = await staffMessages.getUnreadCount(req.user, req.orgScope);
      res.json({ success: true, data: { unread: count } });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to load unread count", error: error.message });
    }
  }

  // GET /api/messages/thread/:patientId — unified in-app+SMS thread; marks inbound
  // read for the WHOLE team. Access is re-checked (org boundary + assignment).
  async getPatientThread(req, res) {
    try {
      const patientId = parseInt(req.params.patientId, 10);
      if (!Number.isInteger(patientId)) {
        return res.status(400).json({ success: false, message: "Invalid patientId" });
      }
      const allowed = await staffMessages.canAccessPatient(req.user, req.orgScope, patientId);
      if (!allowed) {
        return res.status(404).json({ success: false, message: "Not found" });
      }
      const messages = await staffMessages.getThread(patientId);
      // Shared mark-read: clears the unread badge for everyone.
      await staffMessages.markThreadRead(patientId, req.user.id);
      res.json({ success: true, data: messages });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to load thread", error: error.message });
    }
  }

  // POST /api/messages/:patientId/clinical-sms — flag-gated outbound clinical SMS
  // (CLINICIAN_SMS_DESIGN Phase 2, increment 3). Body: { text, mode: 'free_text'|'nudge' }.
  // All gating is server-side in notification.sendClinicalMessage (flag -> canSend ->
  // consent -> opt-out -> hard-disable); this handler only maps the reason to a status.
  // No PHI is logged (only err.message on failure).
  async sendClinicalSms(req, res) {
    try {
      const patientId = parseInt(req.params.patientId, 10);
      if (!Number.isInteger(patientId)) {
        return res.status(400).json({ ok: false, message: "Invalid patientId" });
      }
      const b = req.body || {};
      const mode = b.mode === "nudge" ? "nudge" : "free_text";

      const result = await notif.sendClinicalMessage({
        actor: req.user,
        patientId,
        text: b.text,
        mode,
      });

      if (result.ok) {
        // Record which consent-wording version authorized this free-text message, so a
        // later revision (v2, …) is traceable per message. No PHI — version + ids only.
        if (result.mode === "free_text") {
          await audit.record({
            req,
            action: audit.ACTIONS.SMS_CLINICAL_MESSAGE_SENT,
            entityType: "patient",
            entityId: patientId,
            organizationId: req.orgScope,
            metadata: {
              version: result.authorized_version,
              message_id: result.message_id,
              notification_log_id: result.notification_log_id,
            },
          });
        }
        return res
          .status(200)
          .json({ ok: true, mode: result.mode, message_id: result.message_id });
      }
      // Distinct reason per gate. not_permitted is a real authz denial (403);
      // empty_text is a bad request (400); the rest are policy/transport outcomes (200).
      const status =
        result.reason === "not_permitted"
          ? 403
          : result.reason === "empty_text"
          ? 400
          : 200;
      return res.status(status).json({ ok: false, reason: result.reason });
    } catch (err) {
      console.error("sendClinicalSms error:", err.message);
      return res.status(500).json({ ok: false, message: "Server error" });
    }
  }

  async sendMessage(req, res) {
    try {
      const { receiverId, message } = req.body;
      const senderId = req.user.id; // From JWT middleware

      if (!receiverId || !message || !String(message).trim()) {
        return res.status(400).json({
          success: false,
          message: "receiverId and a non-empty message are required",
        });
      }

      // ACCESS GATE — a message is patient<->staff; enforce it by direction so a
      // patient can't message another patient and staff can't message a patient
      // outside their scope. (Was only authRequired.)
      const allowed = await messageService.canSend(req.user, receiverId);
      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: "You are not permitted to message this recipient",
        });
      }

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
      // REDACTED: req.user is the full JWT payload (PII). Id only.
      console.log("getUserConversations — actor:", req.user?.id);
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
      // REDACTED: req.user is the full JWT payload (PII). Id only.
      console.log("getPatients called — actor:", req.user?.id);

      // Visibility scoped by role in the service: org-wide roles see the org's
      // patients (req.orgScope), a clinician sees their assigned patients.
      const patients = await messageService.getPatients(req.user, req.orgScope);

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
