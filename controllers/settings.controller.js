const { updateSettingsService } = require("../services/settings.service");
const jwt = require("jsonwebtoken");


const updateSettingsController = async (req, res) => {
  try {
    console.log("Update settings request body:", req.body);

    // Check for empty request body
    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: "No changes provided" });
    }

    // 1. Get token from cookies
    const token = req.cookies.token;
    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    // 2. Verify & decode JWT
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log("Decoded token:", decoded);
    } catch (err) {
      console.log("JWT verification error:", err);
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const userId = decoded.id;

    // 3. Extract fields from request body
    const { name, username, email, phone } = req.body;
    console.log("Fields to update:", { name, username, email, phone });

    // 4. Call service to update settings
    const result = await updateSettingsService(userId, {
      name,
      username,
      email,
      phone,
    });

    // Handle case where nothing was updated
    if (!result) {
      return res.status(200).json({ message: "No changes applied" });
    }

    // Rename fields to match frontend expectations
    const userResponse = {
      id: result.id,
      name: result.name,
      userName: result.username,
      email: result.email,
      phoneNumber: result.phoneNumber,
    };

    return res.status(200).json({
      message: "Settings updated successfully",
      user: userResponse,
    });
  } catch (error) {
    console.error("Update settings error:", error);
    if (error.code === "USERNAME_TAKEN") {
      return res.status(400).json({ error: "Username already taken" });
    }
    if (error.code === "EMAIL_TAKEN") {
      return res.status(400).json({ error: "Email already taken" });
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
