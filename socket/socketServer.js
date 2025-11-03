// socket/socketServer.js - CORRECTED FOR LOCALHOST:3000
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");

let io;
const userSockets = new Map();

const initializeSocket = (server) => {
  io = new Server(server, {
    // REMOVE path or set to default
    // path: "/socket.io", // This is default, so you can remove it completely
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

  // Authentication middleware
  io.use((socket, next) => {
    let token;

    // Try to get token from cookies
    if (socket.handshake.headers.cookie) {
      const cookies = cookie.parse(socket.handshake.headers.cookie);
      token = cookies.token;
    }

    // Fallback: check query parameters
    if (!token && socket.handshake.query.token) {
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

  // Connection Events
  io.on("connection", (socket) => {
    console.log(
      `✅ User Connected → ID: ${socket.userId}, Socket: ${socket.id}`
    );
    console.log("📡 Transport:", socket.conn.transport.name);

    userSockets.set(socket.userId.toString(), socket.id);
    console.log("📊 Connected Users:", Array.from(userSockets.entries()));

    // Send immediate test message
    socket.emit("test_connection", {
      message: "Hello from Socket.IO server on localhost:3000!",
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

    // Join private chat room
    socket.on("join_room", (receiverId) => {
      const roomId = [socket.userId, receiverId].sort().join("_");
      socket.join(roomId);
      console.log(`🚪 User ${socket.userId} joined room ${roomId}`);

      socket.emit("room_joined", {
        roomId,
        message: "Successfully joined room",
        timestamp: new Date(),
      });
    });

    // Send message to room
    socket.on("send_message", (data) => {
      const { receiverId, message } = data;
      const roomId = [socket.userId, receiverId].sort().join("_");

      console.log(`📤 Sending message to room ${roomId}:`, message);

      io.to(roomId).emit("new_message", {
        senderId: socket.userId,
        receiverId,
        message,
        timestamp: new Date(),
      });
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

  console.log("✅ Socket.IO initialized on localhost:3000");
  return io;
};

const getIO = () => {
  if (!io) throw new Error("Socket.io not initialized!");
  return io;
};

module.exports = {
  initializeSocket,
  getIO,
  userSockets,
};
