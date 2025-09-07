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
    console.log("Request Cookies:", req.cookies);
    console.log(req);
    if (!token || !refreshToken) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    // Verify access token
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, email, role }

    // console.log("Payload: ", payload);

    // console.log("Payload: ", payload);

    // Get device info
    // const deviceFingerprint = req.headers["x-device-fingerprint"];
    const deviceFingerprint = "unique-browser-hash"; // For testing, replace with actual fingerprinting logic
    const userAgent = req.headers["user-agent"];
    const ipAddress =
      req.headers["x-forwarded-for"] || req.connection.remoteAddress;

    // Lookup in DB via service
    const device = await findUserDeviceSession({
      userId: payload.id,
      refreshToken,
      deviceFingerprint,
      userAgent,
      ipAddress,
    });

    if (!device) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    // Check absolute expiration
    const now = new Date();
    if (device.absolute_expires_at && now > device.absolute_expires_at) {
      return res.status(401).json({
        ok: false,
        message: "Session expired. Please log in again.",
      });
    }

    // ✅ Passed all checks
    next();
  } catch (err) {
    console.error("Auth error:", err.message);
    return res
      .status(401)
      .json({ ok: false, message: "Invalid or expired token" });
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
