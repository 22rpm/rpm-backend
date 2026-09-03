const { updateSettingsService } = require("../services/settings.service");
const jwt = require("jsonwebtoken");

const updateSettingsController = async (req, res) => {
  try {
    console.log("Update settings request body:", req.body);

    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: "No changes provided" });
    }

    const token = req.cookies.token;
    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      // REDACTED: the decoded JWT payload carries name/email/phone/role_type/org_id
      // — do not log it. See SECURITY_FOLLOWUPS.
      console.log("Token verified for user:", decoded?.id);
    } catch (err) {
      console.log("JWT verification error:", err);
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const userId = decoded.id;
    const { name, username, email, phoneNumber } = req.body;
    // REDACTED: log which fields are being changed, not their values (name/email/
    // phone are PII). See SECURITY_FOLLOWUPS.
    console.log("Fields to update:", {
      name: name !== undefined,
      username: username !== undefined,
      email: email !== undefined,
      phoneNumber: phoneNumber !== undefined,
    });

    const result = await updateSettingsService(userId, {
      name,
      username,
      email,
      phoneNumber,
    });

    if (!result) {
      return res.status(200).json({ message: "No changes applied" });
    }

    // Generate new token with updated user data. Must match issueSession's
    // payload shape: tokens carry role_type and org_id (NOT role). The old
    // payload preserved decoded.role (undefined) and dropped org_id entirely —
    // so after a settings change the user lost their role_type AND org_id, which
    // breaks requireRole and resolveOrgScope (non-super-admins would 403).
    const newToken = jwt.sign(
      {
        id: result.id,
        name: result.name,
        username: result.username,
        email: result.email,
        role_type: decoded.role_type,
        org_id: decoded.org_id,
        phoneNumber: result.phoneNumber ?? decoded.phoneNumber,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" } // Adjust expiration as needed
    );

    // Set new token in cookies
    res.cookie("token", newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 3600000, // 1 hour in milliseconds
    });

    const userResponse = {
      id: result.id,
      name: result.name,
      userName: result.username,
      email: result.email,
      phoneNumber: result.phoneNumber,
      role: result.role, // Include role if needed by frontend
    };

    return res.status(200).json({
      message: "Settings updated successfully",
      user: userResponse,
    });
  } catch (error) {
    console.error("Update settings error:", error);
    if (error.code === "USERNAME_TAKEN") {
      return res.status(409).json({ error: "Username already taken" });
    }
    if (error.code === "EMAIL_TAKEN") {
      return res.status(409).json({ error: "Email already taken" });
    }
    if (error.code === "INVALID_EMAIL") {
      return res.status(400).json({ error: "Invalid email format" });
    }
    if (error.code === "INVALID_PHONE") {
      return res.status(400).json({ error: "Invalid phone number format" });
    }
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

module.exports = { updateSettingsController };
