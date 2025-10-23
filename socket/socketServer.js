const socketIo = require("socket.io");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");

let io;
const userSockets = new Map();

const initializeSocket = (server) => {
  io = socketIo(server, {
    cors: {
      origin: [
        "http://localhost:5174",
        "http://localhost:5173",
        "http://50.18.96.20",
        "https://rmtrpm.duckdns.org",
        "https://rmtrpm.duckdns.org/rpm",
      ],
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: "/socket.io",
  });

  // Auth middleware
  io.use((socket, next) => {
    let token;

    if (socket.handshake.headers.cookie) {
      const cookies = cookie.parse(socket.handshake.headers.cookie);
      token = cookies.token;
    }

    console.log("🔐 Socket auth - Token present:", !!token);

    if (!token) {
      console.log("❌ Socket auth - No token found");
      return next(new Error("Authentication error"));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log("✅ Socket auth - User authenticated:", decoded.id);
      socket.userId = decoded.id;
      next();
    } catch (err) {
      console.log("❌ Socket auth - Token invalid:", err.message);
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", (socket) => {
    console.log(
      "✅ User connected - ID:",
      socket.userId,
      "Socket ID:",
      socket.id
    );

    userSockets.set(socket.userId.toString(), socket.id);

    console.log(
      "📊 Currently connected users:",
      Array.from(userSockets.entries())
    );

    // Test connection
    socket.emit("test_connection", {
      message: "Hello from server!",
      userId: socket.userId,
      timestamp: new Date(),
    });

    socket.on("join_room", (receiverId) => {
      const roomId = [socket.userId, receiverId].sort().join("_");
      socket.join(roomId);
      console.log(`🚪 User ${socket.userId} joined room ${roomId}`);
    });

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

    socket.on("disconnect", (reason) => {
      console.log(
        "❌ User disconnected - ID:",
        socket.userId,
        "Reason:",
        reason
      );
      userSockets.delete(socket.userId.toString());
      console.log(
        "📊 Remaining connected users:",
        Array.from(userSockets.entries())
      );
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }
  return io;
};

module.exports = {
  initializeSocket,
  getIO,
  userSockets,
};
