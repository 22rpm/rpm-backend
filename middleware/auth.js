// middleware/auth.js
const jwt = require("jsonwebtoken");
const { findUserDeviceSession } = require("../services/auth.service");

const COOKIE_NAME = process.env.JWT_COOKIE_NAME || "auth_token";

// function authRequired(req, res, next) {
//   try {
//     console.log(req.cookies);
//     const token = req.cookies.token;
//     console.log("Token from cookies:", token);
//     if (!token)
//       return res.status(401).json({ ok: false, message: "Unauthorized" });

//     const payload = jwt.verify(token, process.env.JWT_SECRET);
//     req.user = payload; // { id, email, username, role }
//     console.log("JWT_SECRET in middleware:", process.env.JWT_SECRET);

//     next();
//   } catch (err) {
//     return res
//       .status(401)
//       .json({ ok: false, message: "Invalid or expired token" });
//   }
// }

async function authRequired(req, res, next) {
  try {
    const token = req.cookies.token;
    const refreshToken = req.cookies.refresh_token;
    
    // console.log("=== AUTH REQUIRED MIDDLEWARE ===");
    // console.log("Request Cookies:", req.cookies);
    // console.log("Token present:", !!token);
    // console.log("Refresh Token present:", !!refreshToken);

    if (!token || !refreshToken) {
      console.log("Missing tokens - Token:", !!token, "Refresh:", !!refreshToken);
      return res.status(401).json({ ok: false, message: "Unauthorized - Missing tokens" });
    }

    // Verify access token
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // console.log("Token payload:", payload);
    req.user = payload;

    const deviceFingerprint = "unique-browser-hash";
    const userAgent = req.headers["user-agent"];
    const ipAddress = req.headers["x-forwarded-for"]?.split(",")[0] || req.ip;

    // console.log("Looking for device session with:", {
    //   userId: payload.id,
    //   refreshToken: refreshToken.substring(0, 10) + "...", // Log first 10 chars only
    //   deviceFingerprint,
    // });

    // Lookup in DB via service
    const device = await findUserDeviceSession({
      userId: payload.id,
      refreshToken,
      deviceFingerprint,
      userAgent,
      ipAddress,
    });

    console.log("Device session found:", !!device);

    if (!device) {
      console.log("No device session found in database");
      return res.status(401).json({ ok: false, message: "Unauthorized - No session" });
    }

    // Check absolute expiration
    const now = new Date();
    if (device.absolute_expires_at && now > device.absolute_expires_at) {
      console.log("Session expired:", device.absolute_expires_at);
      return res.status(401).json({
        ok: false,
        message: "Session expired. Please log in again.",
      });
    }

    console.log("✅ Auth passed successfully");
    next();
  } catch (err) {
    console.error("Auth error:", err.message);
    if (err.name === "JsonWebTokenError") {
      return res.status(401).json({ ok: false, message: "Invalid token" });
    }
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ ok: false, message: "Token expired" });
    }
    return res.status(401).json({ ok: false, message: "Authentication failed" });
  }
}
// this is being used in live chat messageService
function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1]; // after "Bearer"
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // 🔑 now req.user will exist
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

module.exports = { authRequired, COOKIE_NAME, authMiddleware };
