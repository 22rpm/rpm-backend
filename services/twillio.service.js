// services/twilioService.js
require("dotenv").config();

const twilio = require("twilio");

class TwilioService {
  constructor() {
    this.client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
  }

  async sendSMS(to, message, opts = {}) {
    try {
      // Validate phone number format
      if (!to || !to.startsWith("+")) {
        console.log(`❌ Invalid phone number format: ${to}`);
        return { success: false, error: "Invalid phone number format" };
      }

      const payload = { body: message, from: this.fromNumber, to };
      // Optional delivery status callback (Twilio POSTs status updates here) —
      // used by the automated-notification pipeline to record delivered/failed.
      if (opts.statusCallback) payload.statusCallback = opts.statusCallback;

      const response = await this.client.messages.create(payload);

      console.log(`✅ SMS sent to ${to}: ${response.sid}`);
      return {
        success: true,
        messageId: response.sid,
        status: response.status,
      };
    } catch (error) {
      console.error(`❌ Failed to send SMS to ${to}:`, error.message);

      // Handle specific Twilio errors
      let userMessage = "Failed to send SMS";
      if (error.code === 21211) {
        userMessage = "Invalid phone number format";
      } else if (error.code === 21608) {
        userMessage = "Number not verified (Twilio trial account)";
      } else if (error.code === 21408) {
        userMessage = "Permission denied to send SMS to this number";
      }

      return {
        success: false,
        error: error.message,
        userMessage: userMessage,
        code: error.code,
      };
    }
  }

  // Format phone number to E.164 format
  formatPhoneNumber(phone) {
    if (!phone) return null;

    // Remove all non-digit characters
    let cleaned = phone.replace(/\D/g, "");

    // If number doesn't start with country code, assume US/Canada (+1)
    if (cleaned.length === 10) {
      return `+1${cleaned}`;
    } else if (cleaned.length === 11 && cleaned.startsWith("1")) {
      return `+${cleaned}`;
    }

    return `+${cleaned}`;
  }

  // Generate alert message based on type and details
  generateAlertMessage(
    alertType,
    patientName,
    description,
    organizationName = ""
  ) {
    const urgency = alertType.toUpperCase();
    const baseMessage = `🚨 ${urgency} ALERT: Patient ${patientName} - ${description}`;

    if (organizationName) {
      return `${baseMessage} | ${organizationName}`;
    }

    return baseMessage;
  }
}

module.exports = new TwilioService();
