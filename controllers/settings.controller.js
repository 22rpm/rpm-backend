const { updateSettingsService } = require("../services/settings.service");
const jwt = require("jsonwebtoken");

const updateSettingsController = async (req, res) => {
  try {
    console.log("Update settings request body:", req.body);
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

    const userId = decoded.id; // 👈 ensure your JWT payload has userId

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

    return res.status(200).json({
      message: "Settings updated successfully",
      user: result,
    });
  } catch (error) {
    console.error("Update settings error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

module.exports = { updateSettingsController };
