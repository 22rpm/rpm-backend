// controllers/auth.controller.js
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { loginSchema } = require("../validations/auth.validation");
const {
  findUserByEmail,
  findRoleByUsername,
  updateLastLogin,
} = require("../services/user.service");
const { insertDevData } = require("../services/devData.service");
const { COOKIE_NAME } = require("../middleware/auth");
const { registerSchema } = require("../validations/auth.validation");
const { createUser, assignRole } = require("../services/user.service");
const speakeasy = require("speakeasy");
const { buildFingerprint } = require("../utils/fingerprint");
const {
  getDeviceByHash,
  trustDevice,
  touchDevice,
  getMfa,
  setMfaSecret,
  enableMfa,
} = require("../services/security.service");
const { verifyOtp, createOtp } = require("../services/otp.service");
const { sendOtpEmail } = require("../services/mail.service");
const crypto = require("crypto");
const { saveOrUpdateUserDevice } = require("../services/device.service");
const { deleteRefreshTokenForDevice } = require("../services/auth.service");

const COOKIE_SECURE = process.env.NODE_ENV === "production";

function signJwt(userPayload) {
  return jwt.sign(userPayload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "1h",
    issuer: "rpm-api",
  });
}
function signMfaChallenge(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: "5m",
    issuer: "rpm-api",
    subject: "mfa",
  });
}

// auth.controller.js
async function login(req, res) {
  try {
    const { email, password } = req.body;

    // ✅ Get user from DB through service
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // ✅ Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // ✅ Generate OTP (6-digit)
    const otp = ("" + Math.floor(100000 + Math.random() * 900000)).substring(
      0,
      6
    );
    console.log(`Generated OTP for ${email}: ${otp}`);

    // ✅ Store OTP in otp_tokens table via service
    await createOtp(user.id, otp, "login");

    // ✅ Send OTP (via email service or SMS)
    if (sendOtpEmail) {
      await sendOtpEmail(user.email, otp);
    } else {
      console.log(`OTP for ${email}: ${otp}`); // fallback for dev
    }

    return res.status(200).json({ message: "OTP sent, please verify" });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

// async function login(req, res) {
//   try {
//     const { email, password } = req.body;

//     // ✅ Get user from DB
//     const user = await findUserByEmail(email);
//     if (!user) {
//       return res.status(401).json({ message: "Invalid credentials" });
//     }

//     // ✅ Check password
//     const validPassword = await bcrypt.compare(password, user.password);
//     if (!validPassword) {
//       return res.status(401).json({ message: "Invalid credentials" });
//     }

//     // ✅ Generate JWT (or session)
//     const token = jwt.sign(
//       { id: user.id, role: user.role },
//       process.env.JWT_SECRET || "dev_secret",
//       { expiresIn: "1h" }
//     );

//     // ✅ Respond with user + token
//     return res.status(200).json({
//       ok: true,
//       message: "Login successful",
//       user: {
//         id: user.id,
//         email: user.email,
//         role: user.role,
//         name: user.name,
//       },
//       token,
//     });
//   } catch (err) {
//     console.error("Login error:", err);
//     return res.status(500).json({ error: "Server error" });
//   }
// }

async function me(req, res) {
  // req.user is set by authRequired middleware
  return res.status(200).json({ ok: true, user: req.user });
}

// async function logout(req, res) {
//   res.clearCookie(COOKIE_NAME, {
//     httpOnly: true,
//     secure: COOKIE_SECURE,
//     sameSite: "strict",
//     path: "/",
//   });
//   return res.status(200).json({ ok: true, message: "Logged out" });
// }

async function logout(req, res) {
  try {
    const refreshToken = req.cookies["refresh_token"];
    const deviceFingerprint = req.body.device_fingerprint; // frontend must send it

    if (refreshToken && deviceFingerprint && req.user?.id) {
      // remove refresh token record from DB for this device
      await deleteRefreshTokenForDevice(
        req.user.id,
        deviceFingerprint,
        refreshToken
      );
    }

    // clear access token
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
    });

    // clear refresh token
    res.clearCookie("refresh_token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
    });

    return res.status(200).json({ ok: true, message: "Logged out" });
  } catch (err) {
    console.error("Logout error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function register(req, res) {
  try {
    const { value, error } = registerSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      return res.status(400).json({
        ok: false,
        message: "Validation error",
        details: error.details,
      });
    }

    // Check if email already exists
    const existing = await findUserByEmail(value.email);
    if (existing) {
      return res
        .status(409)
        .json({ ok: false, message: "Email already exists" });
    }

    const hashed = await bcrypt.hash(value.password, 12);
    const userId = await createUser({
      username: value.username,
      name: value.name,
      email: value.email,
      password: hashed,
    });

    await assignRole({
      username: value.username,
      userId,
      role: value.role,
    });

    return res.status(201).json({
      ok: true,
      message: "User created successfully",
      user: {
        id: userId,
        username: value.username,
        name: value.name,
        email: value.email,
        role: value.role,
      },
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function verifyLogin(req, res) {
  const { userId, otp } = req.body;

  const valid = await verifyOtp(userId, otp, "login");
  if (!valid)
    return res.status(400).json({ message: "Invalid or expired OTP" });

  // issue JWT or session here
  return res.json({ message: "Login successful", token: "jwt-token-here" });
}

const verifyOtpController = async (req, res) => {
  try {
    const { email, otp, device_fingerprint } = req.body;

    // 1. Find user
    const user = await findUserByEmail(email);
    if (!user) return res.status(400).json({ error: "User not found" });

    const role = await findRoleByUsername(user.username);

    // 2. Verify OTP via service
    const valid = await verifyOtp(user.id, otp, "login");
    if (!valid)
      return res.status(400).json({ error: "Invalid or expired OTP" });

    // 3. Generate short-lived Access Token (include role in payload)
    const accessToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role }, // 👈 include role
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    
    // 4. Generate Refresh Token
    const refreshToken = crypto.randomBytes(64).toString("hex");

    // 5. Persist/rotate refresh token & session
    await saveOrUpdateUserDevice({
      userId: user.id,
      deviceFingerprint: device_fingerprint,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      refreshToken,
      absoluteExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
    });

    // 6. Set cookies
    res.cookie("token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 15 * 60 * 1000,
    });

    res.cookie("refresh_token", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
    });

    // 7. Respond with role so frontend knows dashboard to show
    return res.status(200).json({
      message: "OTP verified successfully",
      user: {
        id: user.id,
        email: user.email,
        role: role,
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};

async function addDevData(req, res) {
  try {
    const jsonData = req.body; // data from frontend (assumed JSON)

    if (!jsonData || typeof jsonData !== "object") {
      return res.status(400).json({ error: "Invalid JSON data" });
    }

    const newId = await insertDevData(jsonData);

    return res.status(201).json({
      message: "Data inserted successfully",
      id: newId,
    });
  } catch (err) {
    console.error("Error inserting dev data:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

// controllers/auth.controller.js
const refresh = async (req, res) => {
  const oldToken = req.cookies.refresh_token;
  const fingerprint = req.body?.device_fingerprint; // send from client
  if (!oldToken || !fingerprint) {
    return res
      .status(401)
      .json({ error: "Missing refresh token or fingerprint" });
  }

  // Look up session
  const [rows] = await db.query(
    `SELECT * FROM user_devices
     WHERE refresh_token = ? AND device_fingerprint = ? LIMIT 1`,
    [oldToken, fingerprint]
  );
  const session = rows[0];
  if (!session || session.revoked) {
    return res.status(403).json({ error: "Invalid session" });
  }

  // Enforce absolute lifetime
  if (
    session.absolute_expires_at &&
    new Date(session.absolute_expires_at) < new Date()
  ) {
    // hard-expired -> require full login
    await db.query("UPDATE user_devices SET revoked = 1 WHERE id = ?", [
      session.id,
    ]);
    res.clearCookie("auth_token");
    res.clearCookie("refresh_token");
    return res
      .status(401)
      .json({ error: "Session expired, please login again" });
  }

  // Enforce idle timeout (e.g., 15 minutes)
  const IDLE_MINUTES = 15;
  const idleDeadline = new Date(Date.now() - IDLE_MINUTES * 60 * 1000);
  if (
    session.last_activity_at &&
    new Date(session.last_activity_at) < idleDeadline
  ) {
    // require step-up or full login (recommend OTP)
    await db.query("UPDATE user_devices SET revoked = 1 WHERE id = ?", [
      session.id,
    ]);
    res.clearCookie("auth_token");
    res.clearCookie("refresh_token");
    return res
      .status(401)
      .json({ error: "Idle timeout, please re-authenticate" });
  }

  // (Optional) Risk checks: IP/UA drift → require MFA re-challenge
  // if (req.ip !== session.ip_address || req.headers['user-agent'] !== session.user_agent) { ... }

  // Rotate refresh token + issue new access token
  const accessToken = jwt.sign(
    { id: session.user_id },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
  const newRefresh = crypto.randomBytes(64).toString("hex");

  await db.query(
    `UPDATE user_devices
     SET refresh_token = ?, last_used_at = NOW(), last_activity_at = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [newRefresh, session.id]
  );

  res.cookie("auth_token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 15 * 60 * 1000,
  });
  res.cookie("refresh_token", newRefresh, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 14 * 24 * 60 * 60 * 1000,
  });

  return res.json({ ok: true, message: "Session refreshed" });
};

module.exports = {
  login,
  me,
  logout,
  register,
  verifyOtpController,
  verifyLogin,
  addDevData,
  refresh,
};
