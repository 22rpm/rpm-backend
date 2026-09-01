// controllers/auth.controller.js
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
// const pool = require("../config/db"); // Adjust the path to your database configuration
const { loginSchema } = require("../validations/auth.validation");
const db = require("../config/db");

const {
  findUserByEmail,
  findRoleByUsername,
  findRoleByUserId,
  updateLastLogin,
  findUserByUsername,
  findUserByPhone,
} = require("../services/user.service");
const { insertDevData } = require("../services/devData.service");
const { COOKIE_NAME } = require("../middleware/auth");
const { registerSchema } = require("../validations/auth.validation");
const { createUser, assignRole } = require("../services/user.service");
const speakeasy = require("speakeasy");
const { buildFingerprint, buildDeviceFingerprint } = require("../utils/fingerprint");
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
const {
  deleteRefreshTokenForDevice,
  assignDoctorsToPatient,
} = require("../services/auth.service");
const twilioService = require("../services/twillio.service");

const TRUST_DAYS = 60;

// Session-cookie flags — the SINGLE source of truth for both setting and clearing
// the auth cookies, so they can NEVER drift (a cookie set with SameSite=None but
// cleared with SameSite=Strict may not clear, leaving a live session after logout).
// Secure + SameSite=None in every environment EXCEPT an explicit local-dev opt-in
// (ALLOW_INSECURE_COOKIES=true, which production must never set). FAIL-SECURE: keyed
// on the insecure opt-in, NOT on NODE_ENV, so a missing/misspelled NODE_ENV can't
// downgrade prod. Prod (no flag) is byte-identical: { secure:true, sameSite:'none' }.
function sessionCookieFlags() {
  const secure = process.env.ALLOW_INSECURE_COOKIES !== "true";
  return { secure, sameSite: secure ? "none" : "lax" };
}

// Treat an identifier as a phone number when it has no "@", contains only
// phone-ish characters, and has 7-15 digits once punctuation is stripped.
function looksLikePhone(identifier) {
  if (!identifier || String(identifier).includes("@")) return false;
  const raw = String(identifier).trim();
  if (!/^[\d\s()+\-.]+$/.test(raw)) return false;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}
const { log } = require("console");
const audit = require("../services/audit.service");
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

async function updateUserLastLogin(userId) {
  try {
    await db.query("UPDATE users SET last_login = ? WHERE id = ?", [
      new Date(),
      userId,
    ]);
    console.log(`✅ Last login updated for user ID: ${userId}`);
  } catch (err) {
    console.error("❌ Failed to update last login:", err);
  }
}

// auth.controller.js
// controllers/auth.controller.js
// async function login(req, res) {
//   try {
//     const { identifier, password, method, login_method } = req.body;

//     // Determine if identifier is email or username
//     let user;
//     if (method === "email") {
//       user = await findUserByEmail(identifier);
//     } else {
//       user = await findUserByUsername(identifier);
//     }

//     if (!user) {
//       return res.status(401).json({ message: "Invalid credentials" });
//     }

//     // ✅ Check password
//     const validPassword = await bcrypt.compare(password, user.password);
//     if (!validPassword) {
//       return res.status(401).json({ message: "Invalid credentials" });
//     }

//     // Get user role
//     const role = await findRoleByUsername(user.username);
//     console.log("Fetched role from database:", role); // 👈 ADD THIS LOG

//     if (!role) {
//       return res.status(401).json({ message: "User role not found" });
//     }
//     const role_type = role;
//     const org_id = user.organization_id;
//     console.log(
//       "user role nd org id in the login  ",
//       user.organization_id,
//       role_type
//     );
//     // If login method is username, directly authenticate without OTP
//     if (method === "username" || login_method === "biometric") {
//       // Generate access token - MAKE SURE ROLE IS INCLUDED
//       const accessToken = jwt.sign(
//         {
//           id: user.id,
//           name: user.name,
//           username: user.username,
//           email: user.email,
//           role_type: role_type, // ✅ now includes role
//           org_id: org_id,
//           phoneNumber: user.phoneNumber,
//         },
//         process.env.JWT_SECRET,
//         { expiresIn: "45m" }
//       );

//       // Generate refresh token
//       const refreshToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
//         expiresIn: "14d",
//       });

//       const deviceFingerprint =
//         req.body.device_fingerprint || "unique-browser-hash";

//       console.log("Setting cookies for username login:");
//       console.log("Access Token present:", !!accessToken);
//       console.log("Refresh Token present:", !!refreshToken);

//       // Save device session
//       await saveOrUpdateUserDevice({
//         userId: user.id,
//         deviceFingerprint: deviceFingerprint,
//         ipAddress: req.headers["x-forwarded-for"]?.split(",")[0] || req.ip,
//         userAgent: req.headers["user-agent"],
//         refreshToken,
//         absoluteExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
//       });

//       // Set cookies - MAKE SURE THESE ARE SET CORRECTLY
//       res.cookie("token", accessToken, {
//         httpOnly: true,
//         secure: process.env.NODE_ENV === "production",
//         sameSite: "strict",
//         maxAge: 45 * 60 * 1000, // 45 minutes
//       });

//       res.cookie("refresh_token", refreshToken, {
//         httpOnly: true,
//         secure: process.env.NODE_ENV === "production",
//         sameSite: "strict",
//         maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
//       });

//       console.log("Cookies set successfully");

//       return res.status(200).json({
//         message: "Login successful",
//         user: {
//           id: user.id,
//           email: user.email,
//           role: role,
//         },
//         token: accessToken,
//       });
//     }

//     // If login method is email, proceed with OTP flow
//     if (method === "email") {
//       // ✅ Generate OTP (6-digit)
//       const otp = ("" + Math.floor(100000 + Math.random() * 900000)).substring(
//         0,
//         6
//       );
//       console.log(`Generated OTP for ${identifier}: ${otp}`);

//       // ✅ Store OTP in otp_tokens table via service
//       await createOtp(user.id, otp, "login");

//       // ✅ Send OTP
//       if (sendOtpEmail) {
//         await sendOtpEmail(user.email, otp);
//       } else {
//         console.log(`OTP for ${identifier}: ${otp}`);
//       }

//       return res.status(200).json({
//         message: "OTP sent, please verify",
//         requiresOtp: true,
//       });
//     }
//   } catch (err) {
//     console.error("Login error:", err);
//     return res.status(500).json({ error: "Server error" });
//   }
// }

// ============================================================================
// STEP 4 — replacement for `login` (currently starts at line 256)
// ============================================================================
//
// Changes from the existing version:
//   1. Accepts a phone number as `identifier` and looks the user up by phone.
//   2. Checks whether this device is already trusted; if so, skips OTP.
//   3. Sends the OTP by SMS when the patient logged in with a phone number,
//      by email otherwise.
//   4. `method === "username"` no longer silently bypasses OTP for phone
//      logins — the app sends method:"username" for anything without an "@".
//
// Password is still required on every path.
// ============================================================================

async function login(req, res) {
  try {
    const { identifier, password, method, login_method } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ message: "Missing credentials" });
    }

    // ---- 1. Resolve the user --------------------------------------------
    // Phone is checked first: the mobile app sends method:"username" for any
    // identifier without an "@", so we cannot rely on `method` alone.
    let user = null;
    let loginChannel = "email"; // how we'll deliver the OTP

    if (looksLikePhone(identifier)) {
      user = await findUserByPhone(identifier);
      loginChannel = "sms";
    } else if (method === "email" || String(identifier).includes("@")) {
      user = await findUserByEmail(identifier);
      loginChannel = "email";
    } else {
      user = await findUserByUsername(identifier);
      loginChannel = "email";
    }
if (!user) {
      audit.recordAsync({
        req,
        actorId: null,
        actorRole: "anonymous",
        action: audit.ACTIONS.LOGIN_FAILURE,
        entityType: "user",
        metadata: { reason: "user_not_found", channel: loginChannel },
      });
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // ---- 2. Password ------------------------------------------------------
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      audit.recordAsync({
        req,
        actorId: user.id,
        actorRole: "unknown",
        action: audit.ACTIONS.LOGIN_FAILURE,
        entityType: "user",
        entityId: user.id,
        organizationId: user.organization_id,
        metadata: { reason: "bad_password" },
      });
      return res.status(401).json({ message: "Invalid credentials" });
    }
    

    // ---- 3. Role ----------------------------------------------------------
    // Resolve by user_id (not the non-unique username) — the user row is already
    // loaded, and role is an authorization boundary (esp. once patient logins may
    // skip the password). Other auth flows still use findRoleByUsername; see the
    // report — they are correct once UNIQUE(users.username) + UNIQUE(role.user_id)
    // land.
    const role = await findRoleByUserId(user.id);
    if (!role) {
      return res.status(401).json({ message: "User role not found" });
    }
    const role_type = role;
    const org_id = user.organization_id;

    // ---- 4. Device trust --------------------------------------------------
    // A device is trusted when a previous OTP was verified on it and that
    // trust has not expired. Trusted devices skip the OTP step.
    const fp = buildDeviceFingerprint(req, req.body.client_device_id);
    const [trustRows] = await db.query(
      `SELECT id, trusted_until, revoked
         FROM user_devices
        WHERE user_id = ? AND device_fingerprint = ?
        LIMIT 1`,
      [user.id, fp.fingerprintHash]
    );
    const knownDevice = trustRows[0] || null;
    const deviceIsTrusted =
      knownDevice &&
      !knownDevice.revoked &&
      knownDevice.trusted_until &&
      new Date(knownDevice.trusted_until) > new Date();

    console.log(
      `Login: user=${user.id} channel=${loginChannel} ` +
        `fp=${fp.fingerprintHash.slice(0, 12)}… (${fp.source}) ` +
        `trusted=${!!deviceIsTrusted}`
    );

    // ---- 5. Direct login: trusted device, or biometric re-auth -------------
    if (deviceIsTrusted || login_method === "biometric") {
      return await issueSession({
        req,
        res,
        user,
        role,
        role_type,
        org_id,
        fingerprintHash: fp.fingerprintHash,
        // Re-issuing a session on an already-trusted device extends the
        // window; biometric on an untrusted device does not grant trust.
        extendTrust: !!deviceIsTrusted,
      });
    }

    // ---- 6. Otherwise: send an OTP ----------------------------------------
    // Cryptographically secure — this is a second factor on PHI, so not Math.random.
    const otp = String(crypto.randomInt(100000, 1000000));
    await createOtp(user.id, otp, "login");

    if (loginChannel === "sms") {
      const to = twilioService.formatPhoneNumber(user.phoneNumber);
      if (!to) {
        console.error(`No usable phone number for user ${user.id}`);
        return res
          .status(500)
          .json({ error: "No phone number on file for this account" });
      }

      const message =
        `Your 22RPM verification code is ${otp}. ` +
        `It expires in 5 minutes. Do not share this code.`;

      const result = await twilioService.sendSMS(to, message);
      if (!result.success) {
        console.error(`SMS OTP failed for user ${user.id}:`, result.error);
        return res.status(500).json({
          error: result.userMessage || "Failed to send verification code",
        });
      }

      return res.status(200).json({
        message: "OTP sent, please verify",
        requiresOtp: true,
        otpChannel: "sms",
        otpRecipientMasked: maskPhoneTail(user.phoneNumber),
      });
    }

    // email channel
    try {
      if (sendOtpEmail) {
        await sendOtpEmail(user.email, otp);
      } else {
        console.log(`OTP for ${identifier}: ${otp}`);
      }
    } catch (mailErr) {
      console.error(`Email OTP failed for user ${user.id}:`, mailErr.message);
      return res
        .status(500)
        .json({ error: "Failed to send verification code by email" });
    }

    return res.status(200).json({
      message: "OTP sent, please verify",
      requiresOtp: true,
      otpChannel: "email",
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

// ============================================================================
// Shared session issuer — used by the trusted-device path in `login` and by
// `verifyOtpController`. Keeps token/cookie/session logic in one place instead
// of duplicated across both.
// ============================================================================

async function issueSession({
  req,
  res,
  user,
  role,
  role_type,
  org_id,
  fingerprintHash,
  extendTrust,
}) {
  await updateUserLastLogin(user.id);

  const accessToken = jwt.sign(
    {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role_type: role_type || role,
      org_id: org_id ?? user.organization_id,
      phoneNumber: user.phoneNumber,
    },
    process.env.JWT_SECRET,
    { expiresIn: "45m" }
  );

  const refreshToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
    expiresIn: "14d",
  });

  await saveOrUpdateUserDevice({
    userId: user.id,
    deviceFingerprint: fingerprintHash,
    ipAddress: req.headers["x-forwarded-for"]?.split(",")[0] || req.ip,
    userAgent: req.headers["user-agent"],
    refreshToken,
    absoluteExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  });

  if (extendTrust) {
    const trustedUntil = new Date(
      Date.now() + TRUST_DAYS * 24 * 60 * 60 * 1000
    );
    await db.query(
      `UPDATE user_devices
          SET trusted_until = ?
        WHERE user_id = ? AND device_fingerprint = ?`,
      [trustedUntil, user.id, fingerprintHash]
    );
    console.log(
      `Device trusted for user ${user.id} until ${trustedUntil.toISOString()}`
    );
  }

  // Set and clear share sessionCookieFlags() so their flags can never drift.
  const { secure: cookieSecure, sameSite: cookieSameSite } = sessionCookieFlags();

  res.cookie("token", accessToken, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    maxAge: 45 * 60 * 1000,
  });

  res.cookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    maxAge: 14 * 24 * 60 * 60 * 1000,
  });
audit.recordAsync({
    req,
    actorId: user.id,
    actorRole: role_type || role,
    action: audit.ACTIONS.LOGIN_SUCCESS,
    entityType: "user",
    entityId: user.id,
    organizationId: org_id ?? user.organization_id,
    metadata: { trusted_device: !!extendTrust },
  });
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

// Masks a phone number for display: "6617337622" -> "(***) ***-7622"
function maskPhoneTail(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 4) return "your phone";
  return `(***) ***-${digits.slice(-4)}`;
}

// ============================================================================
// STEP 5 — replacement for `verifyOtpController` (currently line 626)
// ============================================================================
//
// Changes from the existing version:
//   1. Accepts `identifier` (what the mobile app actually sends) as well as
//      the legacy `email` field. The current code only reads `email`, so OTP
//      verification from the app fails outright.
//   2. Resolves the user by phone / email / username, matching `login`.
//   3. On success, marks this device trusted for TRUST_DAYS so subsequent
//      logins skip the OTP.
// ============================================================================

const verifyOtpController = async (req, res) => {
  try {
    const { identifier, email, otp } = req.body;
    const lookup = identifier || email;

    if (!lookup || !otp) {
      return res.status(400).json({ error: "Missing identifier or OTP" });
    }

    let user = null;
    if (looksLikePhone(lookup)) {
      user = await findUserByPhone(lookup);
    } else if (String(lookup).includes("@")) {
      user = await findUserByEmail(lookup);
    } else {
      user = await findUserByUsername(lookup);
    }

    if (!user) return res.status(400).json({ error: "User not found" });

    const valid = await verifyOtp(user.id, otp, "login");
    if (!valid) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    // Resolve role by user_id (same authorization primitive as login).
    const role = await findRoleByUserId(user.id);

    // Successful OTP on this device -> trust it going forward.
    const fp = buildDeviceFingerprint(req, req.body.client_device_id);

    return await issueSession({
      req,
      res,
      user,
      role,
      role_type: role,
      org_id: user.organization_id,
      fingerprintHash: fp.fingerprintHash,
      extendTrust: true,
    });
  } catch (err) {
    console.error("verifyOtp error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

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
    const [rows] = await db.execute(
      "SELECT id, name, username, email, organization_id, phoneNumber FROM users WHERE id = ?",
      [userId]
    );
    const [role] = await db.execute(
      "SELECT role_type FROM role WHERE user_id = ? ORDER BY id DESC LIMIT 1",
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
        organizationId: user.organization_id, // 👈 add orgId here
        role: role[0]?.role_type || "user", // 👈 add role here
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

    // Clear with the SAME flags the cookie was set with (sessionCookieFlags) —
    // a mismatch (set SameSite=None, clear SameSite=Strict) can leave the cookie
    // uncleared, i.e. a live session after logout.
    const { secure: cookieSecure, sameSite: cookieSameSite } = sessionCookieFlags();

    // clear access token
    res.clearCookie("token", {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      path: "/",
    });

    // clear refresh token
    res.clearCookie("refresh_token", {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      path: "/",
    });

    return res.status(200).json({ ok: true, message: "Logged out" });
  } catch (err) {
    console.error("Logout error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function register(req, res) {
  // console.log("Before adding user - req.body:", req.body);
  console.log("user dta", req.user);

  try {
    // Extract doctor assignment fields before validation
    const { assignedDoctors, doctorIds, ...userData } = req.body;

    // Map status to is_active
    const modifiedBody = {
      ...userData, // Use the extracted userData (without doctor fields)
      is_active: req.body.status === "Active" ? true : false,
      organization_id: req.user?.organization_id || req.body.organization_id,
    };
    delete modifiedBody.status;

    const { value, error } = registerSchema.validate(modifiedBody, {
      abortEarly: false,
    });
    console.log("Validation result:", { value });
    if (error) {
      return res.status(400).json({
        ok: false,
        message: "Validation error",
        details: error.details,
      });
    }

    // Check email/username uniqueness
    const existingEmail = await findUserByEmail(value.email);
    if (existingEmail) {
      return res
        .status(409)
        .json({ ok: false, message: "Email already exists" });
    }
    const existingUsername = await findUserByUsername(value.username);
    if (existingUsername) {
      return res
        .status(409)
        .json({ ok: false, message: "Username already exists" });
    }

    // Create user
    const hashed = await bcrypt.hash(value.password, 12);
    const userId = await createUser({
      username: value.username,
      name: value.name,
      email: value.email,
      password: hashed,
      phoneNumber: value.phoneNumber || null,
      is_active: value.is_active,
      organization_id: value.organization_id,
    });

    // Save role
    await assignRole({
      username: value.username,
      userId,
      role: value.role,
    });

    // If role is patient and doctorIds were provided → assign doctors
    // Use the extracted doctorIds from the original req.body
    if (value.role === "patient" && doctorIds?.length) {
      await assignDoctorsToPatient(userId, doctorIds, req.user.id);
    }

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
        organization_id: value.organization_id,
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

// const refresh = async (req, res) => {
//   try {
//     const refreshToken = req.cookies.refresh_token;
//     console.log("Refresh token request received:", req.cookies);
//     console.log("Refresh token request received:", refreshToken);
//     if (!refreshToken)
//       return res.status(401).json({ message: "No refresh token" });

//     // Verify refresh token
//     jwt.verify(refreshToken, process.env.JWT_SECRET, async (err, decoded) => {
//       if (err)
//         return res.status(403).json({ message: "Invalid refresh token" });

//       // Check if still valid in DB
//       const [rows] = await pool.query(
//         "SELECT * FROM users WHERE id = ? AND refresh_token = ?",
//         [decoded.id, refreshToken]
//       );

//       if (rows.length === 0) {
//         return res.status(403).json({ message: "Invalid refresh token" });
//       }

//       // Generate new access token
//       const accessToken = jwt.sign(
//         { id: decoded.id, email: decoded.email },
//         process.env.JWT_SECRET,
//         { expiresIn: "15m" }
//       );

//       res.cookie("accessToken", accessToken, {
//         httpOnly: true,
//         sameSite: "strict",
//         secure: process.env.NODE_ENV === "production",
//         maxAge: 15 * 60 * 1000,
//       });

//       res.json({ message: "Access token refreshed" });
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Server error" });
//   }
// };
// const refresh = async (req, res) => {
//   try {
//     const refreshToken = req.cookies.refresh_token;
//     console.log("Refresh token request received");

//     if (!refreshToken) {
//       return res.status(401).json({ message: "No refresh token" });
//     }

//     // Verify refresh token
//     jwt.verify(refreshToken, process.env.JWT_SECRET, async (err, decoded) => {
//       if (err) {
//         console.error("JWT verification error:", err);
//         return res.status(403).json({ message: "Invalid refresh token" });
//       }

//       try {
//         // Check if refresh token exists in user_devices table (correct table)
//         const [deviceRows] = await db.query(
//           "SELECT ud.*, u.* FROM user_devices ud JOIN users u ON ud.user_id = u.id WHERE ud.refresh_token = ? AND ud.user_id = ?",
//           [refreshToken, decoded.id]
//         );

//         if (deviceRows.length === 0) {
//           return res.status(403).json({ message: "Invalid refresh token" });
//         }

//         const user = deviceRows[0];

//         // Get user role
//         const role = await findRoleByUsername(user.username);

//         // Generate new access token with FULL user data (same as login)
//         const accessToken = jwt.sign(
//           {
//             id: user.id,
//             name: user.name,
//             username: user.username,
//             email: user.email,
//             role_type: role,
//             org_id: user.organization_id,
//             phoneNumber: user.phoneNumber,
//           },
//           process.env.JWT_SECRET,
//           { expiresIn: "45m" } // Keep it 45 minutes
//         );

//         // Set cookie with CORRECT name "token" (not "accessToken")
//         res.cookie("token", accessToken, {
//           httpOnly: true,
//           // secure: process.env.NODE_ENV === "production",
//           secure: false,
//           sameSite: "lax",
//           maxAge: 45 * 60 * 1000, // 45 minutes
//         });

//         console.log("Access token refreshed successfully");
//         res.json({
//           message: "Access token refreshed",
//           user: {
//             id: user.id,
//             name: user.name,
//             email: user.email,
//             username: user.username,
//             role: role,
//             organization_id: user.organization_id,
//             phoneNumber: user.phoneNumber,
//           },
//         });
//       } catch (dbError) {
//         console.error("Database error during token refresh:", dbError);
//         return res.status(500).json({ message: "Server error" });
//       }
//     });
//   } catch (err) {
//     console.error("Refresh token endpoint error:", err);
//     res.status(500).json({ message: "Server error" });
//   }
// };
const refresh = async (req, res) => {
  try {
    const refreshToken = req.cookies.refresh_token;
    console.log("Refresh token request received");

    if (!refreshToken) {
      return res.status(401).json({ message: "No refresh token" });
    }

    jwt.verify(refreshToken, process.env.JWT_SECRET, async (err, decoded) => {
      if (err) {
        console.error("JWT verification error:", err);
        return res.status(403).json({ message: "Invalid refresh token" });
      }

      try {
        const [deviceRows] = await db.query(
          "SELECT ud.*, u.* FROM user_devices ud JOIN users u ON ud.user_id = u.id WHERE ud.refresh_token = ? AND ud.user_id = ?",
          [refreshToken, decoded.id]
        );

        if (deviceRows.length === 0) {
          return res.status(403).json({ message: "Invalid refresh token" });
        }

        const user = deviceRows[0];

        // Check if refresh token is expired
        if (new Date() > new Date(user.absoluteExpiresAt)) {
          return res.status(403).json({ message: "Refresh token expired" });
        }

        // Resolve role by user_id (same authorization primitive as login).
        const role = await findRoleByUserId(user.id);

        const accessToken = jwt.sign(
          {
            id: user.id,
            name: user.name,
            username: user.username,
            email: user.email,
            role_type: role,
            org_id: user.organization_id,
            phoneNumber: user.phoneNumber,
          },
          process.env.JWT_SECRET,
          { expiresIn: "45m" } // PRODUCTION: 45 minutes
        );

        // PRODUCTION cookie settings
        res.cookie("token", accessToken, {
          httpOnly: true,
          secure: true, // PRODUCTION: true for HTTPS
          sameSite: "none", // PRODUCTION: none for cross-site
          maxAge: 45 * 60 * 1000, // 45 minutes
        });

        console.log("Access token refreshed successfully");
        res.json({
          message: "Access token refreshed",
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            username: user.username,
            role: role,
            organization_id: user.organization_id,
            phoneNumber: user.phoneNumber,
          },
        });
      } catch (dbError) {
        console.error("Database error during token refresh:", dbError);
        return res.status(500).json({ message: "Server error" });
      }
    });
  } catch (err) {
    console.error("Refresh token endpoint error:", err);
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
