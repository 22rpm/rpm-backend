// controllers/auth.controller.js
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../config/db"); // Adjust the path to your database configuration
const { loginSchema } = require("../validations/auth.validation");
const {
  findUserByEmail,
  findRoleByUsername,
  updateLastLogin,
  findUserByUsername,
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
// controllers/auth.controller.js
async function login(req, res) {
  try {
    const { identifier, password, method } = req.body;

    // Determine if identifier is email or username
    let user;
    if (method === "email") {
      user = await findUserByEmail(identifier);
    } else {
      user = await findUserByUsername(identifier);
    }

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // ✅ Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Get user role
    const role = await findRoleByUsername(user.username);
    if (!role) {
      return res.status(401).json({ message: "User role not found" });
    }

    // If login method is username, directly authenticate without OTP
    if (method === "username") {
      // Generate access token - MAKE SURE ROLE IS INCLUDED
      const accessToken = jwt.sign(
        {
          id: user.id,
          name: user.name,
          username: user.username,
          email: user.email,
          role: role, // ← This is important!
          phoneNumber: user.phoneNumber,
        },
        process.env.JWT_SECRET,
        { expiresIn: "45m" }
      );

      // Generate refresh token
      const refreshToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
        expiresIn: "14d",
      });

      const deviceFingerprint = req.body.device_fingerprint || "unique-browser-hash";

      console.log("Setting cookies for username login:");
      console.log("Access Token present:", !!accessToken);
      console.log("Refresh Token present:", !!refreshToken);

      // Save device session
      await saveOrUpdateUserDevice({
        userId: user.id,
        deviceFingerprint: deviceFingerprint,
        ipAddress: req.headers["x-forwarded-for"]?.split(",")[0] || req.ip,
        userAgent: req.headers["user-agent"],
        refreshToken,
        absoluteExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      });

      // Set cookies - MAKE SURE THESE ARE SET CORRECTLY
      res.cookie("token", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 45 * 60 * 1000, // 45 minutes
      });

      res.cookie("refresh_token", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
      });

      console.log("Cookies set successfully");

      return res.status(200).json({
        message: "Login successful",
        user: {
          id: user.id,
          email: user.email,
          role: role,
        },
        token: accessToken,
      });
    }

    // If login method is email, proceed with OTP flow
    if (method === "email") {
      // ✅ Generate OTP (6-digit)
      const otp = ("" + Math.floor(100000 + Math.random() * 900000)).substring(
        0,
        6
      );
      console.log(`Generated OTP for ${identifier}: ${otp}`);

      // ✅ Store OTP in otp_tokens table via service
      await createOtp(user.id, otp, "login");

      // ✅ Send OTP
      if (sendOtpEmail) {
        await sendOtpEmail(user.email, otp);
      } else {
        console.log(`OTP for ${identifier}: ${otp}`);
      }

      return res.status(200).json({
        message: "OTP sent, please verify",
        requiresOtp: true,
      });
    }
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

// controllers/auth.controller.js
async function me(req, res) {
  try {
    const userId = req.user.id; // From JWT token via authRequired middleware
    const [rows] = await pool.execute(
      "SELECT id, name, username, email, phoneNumber FROM users WHERE id = ?",
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const user = rows[0];
    return res.status(200).json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phoneNumber: user.phoneNumber || null,
      },
    });
  } catch (err) {
    console.error("Check-me error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
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
    // const deviceFingerprint = req.body.device_fingerprint; // frontend must send it

    if (refreshToken) {
      // remove refresh token record from DB for this device
      await deleteRefreshTokenForDevice(refreshToken);
    }

    // Prevent caching of this response
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");

    // clear access token
    res.clearCookie("token", {
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
  console.log("Before adding user - req.body:", req.body);
  try {
    // Map status to is_active
    const modifiedBody = {
      ...req.body,
      is_active: req.body.status === "Active" ? true : false,
    };
    delete modifiedBody.status; // Remove status to match schema
    console.log("Before adding user - modifiedBody:", modifiedBody);

    const { value, error } = registerSchema.validate(modifiedBody, {
      abortEarly: false,
    });
    if (error) {
      console.log("Validation error:", error.details);
      return res.status(400).json({
        ok: false,
        message: "Validation error",
        details: error.details,
      });
    }

    console.log("Before adding user - validated value:", value);

    // Check if email already exists
    const existingEmail = await findUserByEmail(value.email);
    if (existingEmail) {
      return res
        .status(409)
        .json({ ok: false, message: "Email already exists" });
    }

    // Check if username already exists
    const existingUsername = await findUserByUsername(value.username);
    if (existingUsername) {
      return res
        .status(409)
        .json({ ok: false, message: "Username already exists" });
    }

    const hashed = await bcrypt.hash(value.password, 12);
    const userId = await createUser({
      username: value.username,
      name: value.name,
      email: value.email,
      password: hashed,
      phoneNumber: value.phoneNumber || null,
      is_active: value.is_active,
    });

    // Query the database to confirm the saved user
    const [savedUser] = await pool.execute(
      `SELECT id, username, name, email, phoneNumber, is_active FROM users WHERE id = ?`,
      [userId]
    );
    console.log("After saving user - saved user data:", savedUser[0]);

    await assignRole({
      username: value.username,
      userId,
      role: value.role,
    });

    console.log("After adding user - userId:", userId);

    return res.status(201).json({
      ok: true,
      message: "User created successfully",
      user: {
        id: userId,
        username: value.username,
        name: value.name,
        email: value.email,
        phoneNumber: value.phoneNumber || null,
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
    console.log("user role ", role);
    // 2. Verify OTP via service
    const valid = await verifyOtp(user.id, otp, "login");
    if (!valid)
      return res.status(400).json({ error: "Invalid or expired OTP" });

    // 3. Generate short-lived Access Token (include role in payload)
    const accessToken = jwt.sign(
      {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        phoneNumber: user.phoneNumber,
      }, // 👈 include role
      process.env.JWT_SECRET,
      { expiresIn: "45m" }
    );

    // 4. Generate Refresh Token
    const refreshToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: "14d",
    });
    // const refreshToken = crypto.randomBytes(64).toString("hex");

    // 5. Persist/rotate refresh token & session
    await saveOrUpdateUserDevice({
      userId: user.id,
      deviceFingerprint: device_fingerprint,
      ipAddress: req.headers["x-forwarded-for"]?.split(",")[0] || req.ip,
      userAgent: req.headers["user-agent"],
      refreshToken,
      absoluteExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
    });

    // 6. Set cookies
    res.cookie("token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      // sameSite: none,
      maxAge: 45 * 60 * 1000,
      // maxAge: 1 * 60 * 1000, // for testing auth
    });

    res.cookie("refresh_token", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      // sameSite: none,
      maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
    });
    console.log("hello user", user);
    // 7. Respond with role so frontend knows dashboard to show
    return res.status(200).json({
      message: "OTP verified successfully",
      user: {
        id: user.id,
        email: user.email,
        role: role,
      },
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
// const refresh = async (req, res) => {
//   console.log("Refresh token request received");
//   const oldToken = req.cookies.refresh_token;
//   const fingerprint = req.body?.device_fingerprint; // send from client
//   if (!oldToken || !fingerprint) {
//     return res
//       .status(401)
//       .json({ error: "Missing refresh token or fingerprint" });
//   }

//   // Look up session
//   const [rows] = await db.query(
//     `SELECT * FROM user_devices
//      WHERE refresh_token = ? AND device_fingerprint = ? LIMIT 1`,
//     [oldToken, fingerprint]
//   );
//   const session = rows[0];
//   if (!session || session.revoked) {
//     return res.status(403).json({ error: "Invalid session" });
//   }

//   // Enforce absolute lifetime
//   if (
//     session.absolute_expires_at &&
//     new Date(session.absolute_expires_at) < new Date()
//   ) {
//     // hard-expired -> require full login
//     await db.query("UPDATE user_devices SET revoked = 1 WHERE id = ?", [
//       session.id,
//     ]);
//     res.clearCookie("auth_token");
//     res.clearCookie("refresh_token");
//     return res
//       .status(401)
//       .json({ error: "Session expired, please login again" });
//   }

//   // Enforce idle timeout (e.g., 15 minutes)
//   const IDLE_MINUTES = 15;
//   const idleDeadline = new Date(Date.now() - IDLE_MINUTES * 60 * 1000);
//   if (
//     session.last_activity_at &&
//     new Date(session.last_activity_at) < idleDeadline
//   ) {
//     // require step-up or full login (recommend OTP)
//     await db.query("UPDATE user_devices SET revoked = 1 WHERE id = ?", [
//       session.id,
//     ]);
//     res.clearCookie("auth_token");
//     res.clearCookie("refresh_token");
//     return res
//       .status(401)
//       .json({ error: "Idle timeout, please re-authenticate" });
//   }

//   // (Optional) Risk checks: IP/UA drift → require MFA re-challenge
//   // if (req.ip !== session.ip_address || req.headers['user-agent'] !== session.user_agent) { ... }

//   // Rotate refresh token + issue new access token
//   const accessToken = jwt.sign(
//     { id: session.user_id },
//     process.env.JWT_SECRET,
//     { expiresIn: "15m" }
//   );
//   const newRefresh = crypto.randomBytes(64).toString("hex");

//   await db.query(
//     `UPDATE user_devices
//      SET refresh_token = ?, last_used_at = NOW(), last_activity_at = NOW(), updated_at = NOW()
//      WHERE id = ?`,
//     [newRefresh, session.id]
//   );

//   res.cookie("auth_token", accessToken, {
//     httpOnly: true,
//     secure: process.env.NODE_ENV === "production",
//     sameSite: "strict",
//     maxAge: 15 * 60 * 1000,
//   });
//   res.cookie("refresh_token", newRefresh, {
//     httpOnly: true,
//     secure: process.env.NODE_ENV === "production",
//     sameSite: "strict",
//     maxAge: 14 * 24 * 60 * 60 * 1000,
//   });

//   return res.json({ ok: true, message: "Session refreshed" });
// };

const refresh = async (req, res) => {
  try {
    const refreshToken = req.cookies.refresh_token;
    console.log("Refresh token request received:", req.cookies);
    console.log("Refresh token request received:", refreshToken);
    if (!refreshToken)
      return res.status(401).json({ message: "No refresh token" });

    // Verify refresh token
    jwt.verify(refreshToken, process.env.JWT_SECRET, async (err, decoded) => {
      if (err)
        return res.status(403).json({ message: "Invalid refresh token" });

      // Check if still valid in DB
      const [rows] = await pool.query(
        "SELECT * FROM users WHERE id = ? AND refresh_token = ?",
        [decoded.id, refreshToken]
      );

      if (rows.length === 0) {
        return res.status(403).json({ message: "Invalid refresh token" });
      }

      // Generate new access token
      const accessToken = jwt.sign(
        { id: decoded.id, email: decoded.email },
        process.env.JWT_SECRET,
        { expiresIn: "15m" }
      );

      res.cookie("accessToken", accessToken, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        maxAge: 15 * 60 * 1000,
      });

      res.json({ message: "Access token refreshed" });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
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
