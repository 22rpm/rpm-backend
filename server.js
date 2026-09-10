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
const overviewRoutes = require("./routes/overview.routes");
const drRoutes = require("./routes/doctor.routes");
const patientRoutes = require("./routes/patient.routes");
const emailRoutes = require("./routes/emailRoute");
const careRoutes = require("./routes/care.routes");
const patientsRoutes = require("./routes/patients.routes");
const medicationsRoutes = require("./routes/medications.routes");
const conditionsRoutes = require("./routes/conditions.routes");
const scheduledCallsRoutes = require("./routes/scheduledCall.routes");
const notificationsRoutes = require("./routes/notifications.routes");
const billingRoutes = require("./routes/billing.routes");
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
app.use("/api/overview", overviewRoutes);
app.use("/api/doctor", drRoutes);
app.use("/api/org", orgRoutes);
app.use("/api/patient", patientRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/care", careRoutes);
app.use("/api/patients", patientsRoutes);
app.use("/api/medications", medicationsRoutes);
app.use("/api/conditions", conditionsRoutes);
app.use("/api/scheduled-calls", scheduledCallsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/billing", billingRoutes);
// Health check endpoint — bare liveness only. Do NOT echo NODE_ENV or infra detail
// to an unauthenticated caller. (SECURITY_FOLLOWUPS #15)
app.get("/health", (req, res) => res.json({ ok: true }));

// --- Greenway (Practice Fusion) SMART Backend Services: public JWKS (Task 1) ---
// Serves ONLY the PUBLIC ES384/P-384 signing key so Greenway can verify our client
// assertions. This is the JWKS URL registered with Greenway. Public + unauthenticated BY
// DESIGN — a JWKS is public key material; no private key, no PHI, ever, on /.well-known/*.
// Reached via an EXACT-MATCH nginx `location = /.well-known/jwks.json` on the api vhost only
// (never a /.well-known/ prefix — that would shadow certbot's acme-challenge and break the
// ~33-day duckdns renewal). Inert until GREENWAY_SIGNING_* are set on the box (returns 503).
// See PRACTICE_FUSION_FHIR_DESIGN.md §3–§4.
const { createPublicKey } = require("crypto");
function buildGreenwayJwks() {
  const pem = process.env.GREENWAY_SIGNING_KEY_PATH
    ? fs.readFileSync(process.env.GREENWAY_SIGNING_KEY_PATH, "utf8")
    : process.env.GREENWAY_SIGNING_PRIVATE_KEY;
  if (!pem || !process.env.GREENWAY_SIGNING_KID) return null;
  const jwk = createPublicKey(pem).export({ format: "jwk" }); // { kty:"EC", crv:"P-384", x, y }
  return {
    keys: [{ ...jwk, use: "sig", alg: "ES384", kid: process.env.GREENWAY_SIGNING_KID }],
  };
}
app.get("/.well-known/jwks.json", (req, res) => {
  try {
    const jwks = buildGreenwayJwks();
    if (!jwks) return res.status(503).json({ ok: false, message: "Signing key not configured" });
    return res.json(jwks);
  } catch (err) {
    console.error("JWKS build failed:", err.message);
    return res.status(503).json({ ok: false, message: "Signing key unavailable" });
  }
});

// Removed unauthenticated /socket-debug — it disclosed NODE_ENV, socket path/topology and
// the live connected-client count. (SECURITY_FOLLOWUPS #15)

// Add to your server.js
app.get("/rpm-be/test-socket", (req, res) => {
  console.log("✅ Test endpoint hit - Backend is running");
  // REDACTED: do NOT log cookie/header VALUES — they carry live session JWTs
  // (token + refresh_token). See SECURITY_FOLLOWUPS.
  console.log("🍪 Cookie present:", !!req.headers.cookie);

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
  // Automated patient-notification scheduler (opt-in via patient comm prefs;
  // send window is clinic-local). Disable with NOTIFICATIONS_SCHEDULER=off.
  notificationScheduler.start();
});
