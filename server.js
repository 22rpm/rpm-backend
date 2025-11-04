// server.js - UPDATED
require("dotenv").config();

const express = require("express");
const http = require("http");
const cookieParser = require("cookie-parser");
const { initializeSocket, getIO } = require("./socket/socketServer"); // ✅ ADD getIO import

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
  "https://rmtrpm.duckdns.org",
  "https://rmtrpm.duckdns.org/rpm",
  "http://rmtrpm.duckdns.org",
];

const cors = require("cors");
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin
      if (!origin) return callback(null, true);

      // Allow all subdomains of duckdns.org
      if (origin.includes("duckdns.org") || origin.includes("localhost")) {
        return callback(null, true);
      }

      if (allowedOrigins.indexOf(origin) !== -1) {
        return callback(null, true);
      } else {
        console.log("🔒 CORS blocked origin:", origin);
        return callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie", "x-user-id"],
    credentials: true,
  })
);

app.use(express.urlencoded({ extended: true }));

// API routes - all under /rpm-be
app.use("/rpm-be/api/messages", messageRoutes); // ✅ Add /rpm-be prefix
app.use("/rpm-be/api/auth", authRoutes);
app.use("/rpm-be/api/dev-data", devDataRoutes);
app.use("/rpm-be/api/admin", adminRoutes);
app.use("/rpm-be/api/settings", settingsRoutes);
app.use("/rpm-be/api/alerts", alertRoutes);
app.use("/rpm-be/api/doctor", drRoutes);
app.use("/rpm-be/api/org", orgRoutes);
app.use("/rpm-be/api/patient", patientRoutes);

// ✅ ADD THESE ROUTES BEFORE THE 404 HANDLER
// Health check endpoint
app.get("/rpm-be/health", (req, res) => {
  try {
    const io = getIO();
    res.json({
      ok: true,
      service: "rpm-api",
      timestamp: new Date().toISOString(),
      socket: "enabled",
      connected_clients: io.engine.clientsCount,
    });
  } catch (error) {
    res.json({
      ok: true,
      service: "rpm-api",
      timestamp: new Date().toISOString(),
      socket: "initializing",
      error: error.message,
    });
  }
});

// Socket.io test endpoint
app.get("/rpm-be/socket-test", (req, res) => {
  res.json({
    message: "Socket.IO server is running",
    supportedTransports: ["polling", "websocket"],
    timestamp: new Date().toISOString(),
    path: "/rpm-be/socket.io",
  });
});

// Socket debug endpoint
app.get("/rpm-be/socket-debug", (req, res) => {
  try {
    const io = getIO();
    const connectedSockets = io.engine.clientsCount;

    res.json({
      ok: true,
      message: "Socket.IO server debug info",
      connected_clients: connectedSockets,
      path: "/rpm-be/socket.io",
      transports: ["websocket", "polling"],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Socket.IO not initialized",
      error: error.message,
    });
  }
});

// Server info endpoint
app.get("/rpm-be/server-info", (req, res) => {
  res.json({
    ok: true,
    server: {
      environment: process.env.NODE_ENV,
      port: process.env.PORT || 4000,
      node_version: process.version,
      platform: process.platform,
    },
    socket: {
      path: "/rpm-be/socket.io",
      cors_enabled: true,
      transports: ["websocket", "polling"],
    },
  });
});

// Root endpoint redirect
app.get("/", (req, res) => {
  res.redirect("/rpm-be/health");
});

// Swagger
const swaggerDocument = JSON.parse(
  fs.readFileSync(path.join(__dirname, "docs/swagger.json"), "utf8")
);

if (process.env.NODE_ENV === "development") {
  app.use(
    "/rpm-be/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerDocument)
  );
  console.log(
    `✅ Swagger docs available at http://localhost:${
      process.env.PORT || 4000
    }/rpm-be/api-docs`
  );
}

// 404 handler - MUST BE LAST
app.use((req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({
    ok: false,
    message: "Not found",
    path: req.path,
    method: req.method,
  });
});

// Initialize Socket.io with the correct path
initializeSocket(server);

const port = process.env.PORT || 4000;
server.listen(port, "0.0.0.0", () => {
  console.log(`🚀 Server started on port ${port}`);
  console.log(`🔌 Socket.io available on path: /rpm-be/socket.io`);
  console.log(`🌐 Health check: https://rmtrpm.duckdns.org/rpm-be/health`);
  console.log(`🔧 Socket test: https://rmtrpm.duckdns.org/rpm-be/socket-test`);
  console.log(
    `🐛 Socket debug: https://rmtrpm.duckdns.org/rpm-be/socket-debug`
  );
});
