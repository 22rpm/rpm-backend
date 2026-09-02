// // server.js
// require("dotenv").config();

// const express = require("express");
// const http = require("http");
// const cookieParser = require("cookie-parser");
// const { initializeSocket } = require("./socket/socketServer");

// const devDataRoutes = require("./routes/deviceData.routes");
// const authRoutes = require("./routes/auth.routes");
// const messageRoutes = require("./routes/messageRoutes");
// const adminRoutes = require("./routes/admin.routes");
// const swaggerUi = require("swagger-ui-express");
// const settingsRoutes = require("./routes/settings.route");
// const orgRoutes = require("./routes/org.routes");
// const alertRoutes = require("./routes/alert.route");
// const drRoutes = require("./routes/doctor.routes");
// const patientRoutes = require("./routes/patient.routes");
// const fs = require("fs");
// const path = require("path");

// const app = express();
// const server = http.createServer(app);

// app.use(express.json());
// app.use(cookieParser());
// app.set("trust proxy", true);

// // Enhanced CORS configuration
// const allowedOrigins = [
//   "http://localhost:5174",
//   "http://localhost:5173",
//   "http://localhost:5175",
//   "http://50.18.96.20",
//   "https://rmtrpm.duckdns.org",
//   "https://rmtrpm.duckdns.org/rpm",
//   "http://rmtrpm.duckdns.org",
// ];

// const cors = require("cors");
// app.use(
//   cors({
//     origin: function (origin, callback) {
//       // Allow requests with no origin
//       if (!origin) return callback(null, true);

//       // Allow all subdomains of duckdns.org
//       if (origin.includes("duckdns.org") || origin.includes("localhost")) {
//         return callback(null, true);
//       }

//       if (allowedOrigins.indexOf(origin) !== -1) {
//         return callback(null, true);
//       } else {
//         console.log("🔒 CORS blocked origin:", origin);
//         return callback(new Error("Not allowed by CORS"));
//       }
//     },
//     methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
//     allowedHeaders: ["Content-Type", "Authorization", "Cookie", "x-user-id"],
//     credentials: true,
//   })
// );

// app.use(express.urlencoded({ extended: true }));

// // API routes - all under /rpm-be
// app.use("/api/messages", messageRoutes);
// app.use("/api/auth", authRoutes);
// app.use("/api/dev-data", devDataRoutes);
// app.use("/api/admin", adminRoutes);
// app.use("/api/settings", settingsRoutes);
// app.use("/api/alerts", alertRoutes);
// app.use("/api/doctor", drRoutes);
// app.use("/api/org", orgRoutes);
// app.use("/api/patient", patientRoutes);

// // Health check endpoint
// app.get("/health", (req, res) =>
//   res.json({
//     ok: true,
//     service: "rpm-api",
//     timestamp: new Date().toISOString(),
//     socket: "enabled",
//   })
// );

// // Add to your server.js
// app.get("/rpm-be/socket-debug", (req, res) => {
//   const io = getIO();
//   const connectedSockets = io.engine.clientsCount;

//   res.json({
//     ok: true,
//     message: "Socket.IO server debug info",
//     connected_clients: connectedSockets,
//     path: "/rpm-be/socket.io",
//     transports: ["websocket", "polling"],
//     timestamp: new Date().toISOString(),
//   });
// });

// // Root endpoint redirect
// app.get("/", (req, res) => {
//   res.redirect("/rpm-be/health");
// });

// // Swagger
// const swaggerDocument = JSON.parse(
//   fs.readFileSync(path.join(__dirname, "docs/swagger.json"), "utf8")
// );

// if (process.env.NODE_ENV === "development") {
//   app.use(
//     "/rpm-be/api-docs",
//     swaggerUi.serve,
//     swaggerUi.setup(swaggerDocument)
//   );
//   console.log(
//     `✅ Swagger docs available at http://localhost:${
//       process.env.PORT || 4000
//     }/rpm-be/api-docs`
//   );
// }

// // 404 handler
// app.use((req, res) =>
//   res.status(404).json({ ok: false, message: "Not found" })
// );

// // Initialize Socket.io with the correct path
// initializeSocket(server);

// const port = process.env.PORT || 4000;
// server.listen(port, "0.0.0.0", () => {
//   console.log(`🚀 Server started on port ${port}`);
//   console.log(`🔌 Socket.io available on path: /rpm-be/socket.io`);
//   console.log(`🌐 Health check: https://rmtrpm.duckdns.org/rpm-be/health`);
//   console.log(`🔧 Socket test: https://rmtrpm.duckdns.org/rpm-be/socket-test`);
// });

// server.js - COMPLETE UPDATED VERSION
require("dotenv").config();

const express = require("express");
const http = require("http");
const cookieParser = require("cookie-parser");
const { initializeSocket, getIO } = require("./socket/socketServer");

const devDataRoutes = require("./routes/deviceData.routes");
const authRoutes = require("./routes/auth.routes");
const messageRoutes = require("./routes/messageRoutes");
const adminRoutes = require("./routes/admin.routes");
const swaggerUi = require("swagger-ui-express");
const settingsRoutes = require("./routes/settings.route");
const orgRoutes = require("./routes/org.routes");
const alertRoutes = require("./routes/alert.route");
const drRoutes = require("./routes/doctor.routes");
const patientRoutes = require("./routes/patient.routes");
const emailRoutes = require("./routes/emailRoute");
const careRoutes = require("./routes/care.routes");
const patientsRoutes = require("./routes/patients.routes");
const medicationsRoutes = require("./routes/medications.routes");
const scheduledCallsRoutes = require("./routes/scheduledCall.routes");
const notificationsRoutes = require("./routes/notifications.routes");
const notificationScheduler = require("./services/notificationScheduler");
const { assertRoleGates } = require("./scripts/checkRoleGates");
// Fail-fast if any route gate reintroduces a scattered role string (SECURITY_FOLLOWUPS
// process guard). Throws in dev/test; logs loudly in production (never crashes a
// running deploy over a lint issue — the pre-deploy `npm run check:roles` is the hard gate).
assertRoleGates();
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(cookieParser());
app.set("trust proxy", true);

// Enhanced CORS configuration
const allowedOrigins = [
  "http://localhost:5174",
  "http://localhost:5173",
  "http://localhost:5175",
  "http://50.18.96.20",
  "https://api.twentytwohealth.com",
  "https://api.twentytwohealth.com/rpm",
  "http://api.twentytwohealth.com",
];

const cors = require("cors");
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (native apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      // Exact-match only. No substring wildcards: a check like
      // origin.includes("localhost") also matches https://localhost.attacker.com,
      // and with credentials:true that lets an attacker-controlled origin ride the
      // user's cookies. Dev origins are listed explicitly in allowedOrigins.
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log("🔒 CORS blocked origin:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie", "x-user-id"],
    credentials: true,
  })
);

app.use(express.urlencoded({ extended: true }));

// API routes - all under /rpm-be
app.use("/api/messages", messageRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/dev-data", devDataRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/doctor", drRoutes);
app.use("/api/org", orgRoutes);
app.use("/api/patient", patientRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/care", careRoutes);
app.use("/api/patients", patientsRoutes);
app.use("/api/medications", medicationsRoutes);
app.use("/api/scheduled-calls", scheduledCallsRoutes);
app.use("/api/notifications", notificationsRoutes);
// Add this temporary test route to check your current setup
app.get("/debug-twilio", (req, res) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

  console.log("🔧 Current Twilio Configuration:");
  console.log("Account SID:", accountSid);
  console.log("Auth Token length:", authToken ? authToken.length : "Missing");
  console.log("Phone Number:", phoneNumber);

  // Check if Account SID is valid
  const isValidSid =
    accountSid && accountSid.startsWith("AC") && accountSid.length === 34;
  const isHex = isValidSid
    ? /^[A-Fa-f0-9]+$/.test(accountSid.substring(2))
    : false;

  res.json({
    twilio_config: {
      account_sid: accountSid,
      account_sid_valid: isValidSid && isHex,
      account_sid_length: accountSid ? accountSid.length : 0,
      auth_token_set: !!authToken,
      phone_number_set: !!phoneNumber,
      issues: [],
    },
    analysis: {
      current_sid_issue:
        "Contains invalid character 'o' in hexadecimal portion",
      expected_format: "AC + 32 hexadecimal characters (0-9, a-f only)",
      example: "ACa1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0",
    },
  });
});
// Health check endpoint
app.get("/health", (req, res) =>
  res.json({
    ok: true,
    service: "rpm-api",
    timestamp: new Date().toISOString(),
    socket: "enabled",
    environment: process.env.NODE_ENV,
  })
);

// Socket debug endpoints
app.get("/socket-debug", (req, res) => {
  const io = getIO();
  const connectedSockets = io.engine.clientsCount;

  res.json({
    ok: true,
    message: "Socket.IO server debug info",
    connected_clients: connectedSockets,
    path:
      process.env.NODE_ENV === "production"
        ? "/rpm-be/socket.io"
        : "/socket.io",
    transports: ["websocket", "polling"],
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// Add to your server.js
app.get("/rpm-be/test-socket", (req, res) => {
  console.log("✅ Test endpoint hit - Backend is running");
  console.log("🍪 Cookies:", req.headers.cookie);
  console.log("📋 Headers:", req.headers);

  res.json({
    status: "running",
    message: "Backend server is operational",
    cookies: req.headers.cookie ? "Present" : "Missing",
    timestamp: new Date().toISOString(),
  });
});
// Root endpoint redirect
app.get("/", (req, res) => {
  res.redirect("/health");
});

// Swagger
if (process.env.NODE_ENV === "development") {
  const swaggerDocument = JSON.parse(
    fs.readFileSync(path.join(__dirname, "docs/swagger.json"), "utf8")
  );

  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  console.log(
    `✅ Swagger docs available at http://localhost:${
      process.env.PORT || 4000
    }/api-docs`
  );
}

// 404 handler
app.use((req, res) =>
  res.status(404).json({ ok: false, message: "Not found" })
);

// Initialize Socket.io
initializeSocket(server);

const port = process.env.PORT || 4000;
server.listen(port, "0.0.0.0", () => {
  console.log(`🚀 Server started on port ${port}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV}`);
  console.log(
    `🔌 Socket path: ${
      process.env.NODE_ENV === "production" ? "/rpm-be/socket.io" : "/socket.io"
    }`
  );
  console.log(`🏥 Health check: http://localhost:${port}/health`);
  console.log(`🔧 Socket debug: http://localhost:${port}/socket-debug`);
  console.log(`🔧 Nginx test: http://localhost:${port}/nginx-test`);
  // Automated patient-notification scheduler (opt-in via patient comm prefs;
  // send window is clinic-local). Disable with NOTIFICATIONS_SCHEDULER=off.
  notificationScheduler.start();
});
