// server.js
require("dotenv").config();

const express = require("express");
const http = require("http");
const cookieParser = require("cookie-parser");
const { initializeSocket } = require("./socket/socketServer");

const devDataRoutes = require("./routes/deviceData.routes");
// const deviceDataRoutes = require("./routes/deviceData.routes");
const authRoutes = require("./routes/auth.routes");
const messageRoutes = require("./routes/messageRoutes");
const adminRoutes = require("./routes/admin.routes");
const swaggerDocs = require("./config/swagger");
const swaggerUi = require("swagger-ui-express");
const settingsRoutes = require("./routes/settings.route");
const orgRoutes = require("./routes/org.routes");
const alertRoutes = require("./routes/alert.route"); // Add this
const drRoutes = require("./routes/doctor.routes");
const patientRoutes = require("./routes/patient.routes");
const fs = require("fs");
const path = require("path");

const app = express();

const server = http.createServer(app);

app.use(express.json());
app.use(cookieParser());
app.set("trust proxy", true);

// Updated CORS configuration - Enhanced for WebSocket support
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Add essential origins if not already present
const essentialOrigins = [
  "http://localhost:5174",
  "http://localhost:5173",
  "http://50.18.96.20",
  "https://rmtrpm.duckdns.org",
  "https://rmtrpm.duckdns.org/rpm",
];

essentialOrigins.forEach((origin) => {
  if (!allowedOrigins.includes(origin)) {
    allowedOrigins.push(origin);
  }
});

if (allowedOrigins.length) {
  const cors = require("cors");
  app.use(
    cors({
      origin: (origin, cb) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return cb(null, true);

        // Check if origin is in allowed list
        if (allowedOrigins.includes(origin)) {
          return cb(null, true);
        }

        // For Socket.IO and same domain variations, be more permissive
        if (
          origin.includes("rmtrpm.duckdns.org") ||
          origin.includes("localhost")
        ) {
          return cb(null, true);
        }

        console.log("❌ CORS blocked origin:", origin);
        return cb(new Error("Not allowed by CORS"));
      },
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
      credentials: true,
    })
  );
  console.log("✅ CORS enabled for origins:", allowedOrigins);
}

app.use(express.urlencoded({ extended: true }));

// app.get('/health', (req, res) => res.json({ ok: true, service: 'rpm-api', ts: new Date().toISOString() }));
app.use("/api/messages", messageRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/dev-data", devDataRoutes);
// app.use("/api/device-data", deviceDataRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/alerts", alertRoutes); // Add this after other routes
app.use("/api/doctor", drRoutes);
app.use("/api/org", orgRoutes);
app.use("/api/patient", patientRoutes);

// ✅ Load swagger.json
const swaggerDocument = JSON.parse(
  fs.readFileSync(path.join(__dirname, "docs/swagger.json"), "utf8")
);

// ✅ Swagger UI (only in dev)
if (process.env.NODE_ENV === "development") {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  console.log(
    `✅ Swagger docs available at http://localhost:${
      process.env.PORT || 4000
    }/api-docs`
  );
}

// 404
app.use((req, res) =>
  res.status(404).json({ ok: false, message: "Not found" })
);

initializeSocket(server);

const port = process.env.PORT || 4000;
server.listen(port, () => console.log(`Server started on ${port}`));
