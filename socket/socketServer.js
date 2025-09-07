// socket/socketServer.js
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');


let io;
const userSockets = new Map(); // Store user_id -> socket_id mapping

const initializeSocket = (server) => {
  io = socketIo(server, {
    // For Production, Please change the path and CORS settings accordingly
    // path: "/rpm-be/socket.io/", 
    cors: {
      origin: ["http://localhost:5174","http://50.18.96.20"], // Adjust to your client URL
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  // Auth middleware
  io.use((socket, next) => {
    // const token = socket.handshake.auth.token;
     let token;

    // Parse cookies from handshake headers
    if (socket.handshake.headers.cookie) {
      const cookies = cookie.parse(socket.handshake.headers.cookie);
      token = cookies.token; // "token" is the name of your JWT cookie
    }

    if (!token) {
      return next(new Error('Authentication error'));
    }
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log('User connected:', socket.userId);
    userSockets.set(socket.userId, socket.id);

    socket.on('join_room', (receiverId) => {
      const roomId = [socket.userId, receiverId].sort().join('_');
      socket.join(roomId);
    });

    socket.on('send_message', (data) => {
      const { receiverId, message } = data;
      const roomId = [socket.userId, receiverId].sort().join('_');
      
      // Emit to room
      io.to(roomId).emit('new_message', {
        senderId: socket.userId,
        receiverId,
        message,
        timestamp: new Date()
      });
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.userId);
      userSockets.delete(socket.userId);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
};

module.exports = {
  initializeSocket,
  getIO,
  userSockets
};