// server.js
require("dotenv").config();

const express = require("express");
const http = require("http");
const cookieParser = require("cookie-parser");
const { initializeSocket } = require("./socket/socketServer");

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
  "http://50.18.96.20",
  "https://rmtrpm.duckdns.org",
  "https://rmtrpm.duckdns.org/rpm",
];

const cors = require("cors");
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or postman)
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) !== -1) {
        return callback(null, true);
      } else {
        console.log("🔒 CORS blocked origin:", origin);
        return callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
    credentials: true,
  })
);

app.use(express.urlencoded({ extended: true }));

// API routes
app.use("/api/messages", messageRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/dev-data", devDataRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/doctor", drRoutes);
app.use("/api/org", orgRoutes);
app.use("/api/patient", patientRoutes);

// Health check endpoint
app.get("/health", (req, res) =>
  res.json({
    ok: true,
    service: "rpm-api",
    timestamp: new Date().toISOString(),
  })
);

// Swagger
const swaggerDocument = JSON.parse(
  fs.readFileSync(path.join(__dirname, "docs/swagger.json"), "utf8")
);

if (process.env.NODE_ENV === "development") {
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
  console.log(`🌐 WebSocket server available at wss://rmtrpm.duckdns.org`);
});
