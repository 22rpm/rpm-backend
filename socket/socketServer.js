const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");

let io;
const userSockets = new Map();

const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:3000",
      ],
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Authentication middleware - FIXED
  io.use((socket, next) => {
    let token;

    // Try to get token from cookies
    if (socket.handshake.headers.cookie) {
      const cookies = cookie.parse(socket.handshake.headers.cookie);
      token = cookies.token;
    }

    // Fallback: check auth object from frontend query
    if (!token && socket.handshake.query) {
      token = socket.handshake.query.token;
    }

    console.log("🔐 Socket Auth - Token Present:", !!token);

    if (!token) {
      console.log("⚠️ No token found, allowing anonymous for testing.");
      socket.userId = "anonymous";
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      console.log("✅ Authenticated Socket User:", decoded.id);
      next();
    } catch (err) {
      console.log("❌ Invalid Token:", err.message);
      socket.userId = "anonymous";
      next();
    }
  });

  // Connection Events - FIXED USER MAPPING
  io.on("connection", (socket) => {
    console.log(
      `✅ User Connected → ID: ${socket.userId}, Socket: ${socket.id}`
    );
    console.log("📡 Transport:", socket.conn.transport.name);

    // ✅ FIX: Store the mapping properly
    if (socket.userId && socket.userId !== "anonymous") {
      userSockets.set(socket.userId.toString(), socket.id);

      // 🔥 CRITICAL: Join user's personal room for alerts
      socket.join(`user_${socket.userId}`);
      console.log(
        `🚪 User ${socket.userId} joined room: user_${socket.userId}`
      );

      console.log("📊 Stored in userSockets:", {
        userId: socket.userId,
        socketId: socket.id,
      });
    }

    console.log("📊 All connected users:", Array.from(userSockets.entries()));

    // Send immediate test message
    socket.emit("test_connection", {
      message: "Hello from Socket.IO server!",
      userId: socket.userId,
      timestamp: new Date(),
      transport: socket.conn.transport.name,
    });

    // Test message handler
    socket.on("test_message", (data) => {
      console.log("📨 Received test message:", data);
      socket.emit("test_response", {
        message: "Test response from server!",
        received: data,
        timestamp: new Date(),
      });
    });

    // Debug: List all connected users
    socket.on("get_connected_users", () => {
      console.log(
        "📊 Current connected users:",
        Array.from(userSockets.entries())
      );
      socket.emit("connected_users_list", {
        users: Array.from(userSockets.entries()),
        total: userSockets.size,
      });
    });

    // Handle disconnect - FIXED
    socket.on("disconnect", (reason) => {
      console.log(
        `❌ User Disconnected → ID: ${socket.userId}, Reason: ${reason}`
      );

      // ✅ FIX: Remove from userSockets properly
      if (socket.userId && socket.userId !== "anonymous") {
        userSockets.delete(socket.userId.toString());
      }

      console.log("📊 Remaining Users:", Array.from(userSockets.entries()));
    });
  });

  console.log("✅ Socket.IO initialized on localhost:3000");
  return io;
};

const getIO = () => {
  if (!io) throw new Error("Socket.io not initialized!");
  return io;
};

// ✅ FIX: Export userSockets properly
module.exports = {
  initializeSocket,
  getIO,
  userSockets,
};
