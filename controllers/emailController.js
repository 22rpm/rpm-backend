const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
dotenv.config();

const sendSupportEmail = async (req, res) => {
  try {
    const { email, message, name = "User" } = req.body;

    if (!email || !message) {
      return res.status(400).json({
        success: false,
        msg: "Email & message are required",
      });
    }

    // 1. Create a Gmail transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER, // Your Gmail
        pass: process.env.GMAIL_PASS, // App password (not regular password)
      },
    });

    // 2. Send to your support email
    await transporter.sendMail({
      from: `"22-RPM Support" <${process.env.GMAIL_USER}>`,
      to: "Info@twentytwohealth.com", // Any email you want!
      replyTo: email, // User's email for reply
      subject: `New Support Request from ${name}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; background: #f4f4f4; padding: 20px; }
            .container { max-width: 600px; margin: auto; background: white; padding: 30px; border-radius: 10px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 10px 10px 0 0; }
            .content { padding: 20px; }
            .message-box { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0; }
            .footer { margin-top: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>📧 New Support Request</h2>
            </div>
            <div class="content">
              <h3>Customer Details</h3>
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
              <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
              
              <h3>Message</h3>
              <div class="message-box">
                ${message}
              </div>
              
              <div style="margin-top: 30px; padding: 15px; background: #e8f4fc; border-radius: 5px;">
                <p><strong>Quick Actions:</strong></p>
                <a href="mailto:${email}" style="background: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 5px;">
                  📨 Reply to Customer
                </a>
              </div>
            </div>
            <div class="footer">
              <p>This support request was submitted via 22-RPM website.</p>
              <p>Please respond within 24-48 hours.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    // 3. Optional: Send confirmation to user
    await transporter.sendMail({
      from: `"22-RPM Support" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "We've received your support request!",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
          <h2 style="color: #4CAF50;">✅ Request Received!</h2>
          <p>Hello ${name},</p>
          <p>Thank you for contacting 22-RPM support. We've received your message and will get back to you within 24-48 hours.</p>
          <div style="background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Your Message:</strong></p>
            <p>${message}</p>
          </div>
          <p>Best regards,<br>22-RPM Support Team</p>
        </div>
      `,
    });

    return res.status(200).json({
      success: true,
      msg: "Support request sent successfully",
    });
  } catch (error) {
    console.error("Email Error:", error);
    return res.status(500).json({
      success: false,
      msg: "Failed to send email",
    });
  }
};
module.exports = {
  sendSupportEmail,
};
