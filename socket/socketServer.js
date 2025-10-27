const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");

let io;
const userSockets = new Map(); // userId -> socketId mapping

const initializeSocket = (server) => {
  io = new Server(server, {
    path: "/rpm-be/socket.io", // Must match frontend & Nginx path
    cors: {
      origin: [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "https://rmtrpm.duckdns.org",
        "https://rmtrpm.duckdns.org/rpm",
        "http://rmtrpm.duckdns.org",
      ],
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // 🔐 Authentication middleware
  io.use((socket, next) => {
    let token;

    // Try to get token from cookies
    if (socket.handshake.headers.cookie) {
      const cookies = cookie.parse(socket.handshake.headers.cookie);
      token = cookies.token;
    }

    // Fallback: check auth object
    if (!token && socket.handshake.auth && socket.handshake.auth.token) {
      token = socket.handshake.auth.token;
    }

    console.log("🔐 Socket Auth - Token Present:", !!token);
    console.log("📡 Socket Path:", socket.handshake.url);

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

  // 🧩 Connection Events
  io.on("connection", (socket) => {
    console.log(
      `✅ User Connected → ID: ${socket.userId}, Socket: ${socket.id}`
    );
    console.log("📡 Transport:", socket.conn.transport.name);
    console.log("🔗 URL Path:", socket.handshake.url);

    userSockets.set(socket.userId.toString(), socket.id);
    console.log("📊 Connected Users:", Array.from(userSockets.entries()));

    // Test message
    socket.emit("test_connection", {
      message: "Hello from Socket.IO server!",
      userId: socket.userId,
      timestamp: new Date(),
      path: "/rpm-be/socket.io",
      transport: socket.conn.transport.name,
    });

    // Join private chat room
    socket.on("join_room", (receiverId) => {
      const roomId = [socket.userId, receiverId].sort().join("_");
      socket.join(roomId);
      console.log(`🚪 User ${socket.userId} joined room ${roomId}`);
    });

    // Send message to room
    socket.on("send_message", (data) => {
      const { receiverId, message } = data;
      const roomId = [socket.userId, receiverId].sort().join("_");

      io.to(roomId).emit("new_message", {
        senderId: socket.userId,
        receiverId,
        message,
        timestamp: new Date(),
      });
    });

    // Detect transport upgrade (polling → websocket)
    socket.conn.on("upgrade", (transport) => {
      console.log(
        `🔄 Transport upgraded for ${socket.userId}: ${transport.name}`
      );
    });

    // Handle disconnect
    socket.on("disconnect", (reason) => {
      console.log(
        `❌ User Disconnected → ID: ${socket.userId}, Reason: ${reason}`
      );
      userSockets.delete(socket.userId.toString());
      console.log("📊 Remaining Users:", Array.from(userSockets.entries()));
    });
  });

  return io;
};

// Export helpers
const getIO = () => {
  if (!io) throw new Error("Socket.io not initialized!");
  return io;
};

module.exports = {
  initializeSocket,
  getIO,
  userSockets,
};
