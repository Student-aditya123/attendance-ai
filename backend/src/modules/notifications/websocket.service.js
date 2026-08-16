/**
 * websocket.service.js — Real-time event broadcasting
 *
 * Architecture:
 *   Redis pub/sub → this service → Socket.io rooms → connected clients
 *
 * Why route through Redis? When we have multiple Node replicas, a QR scan
 * might hit replica A but the faculty's browser is connected to replica B.
 * Redis pub/sub broadcasts to ALL replicas, which then forward to their
 * local Socket.io connections.
 *
 * Rooms:
 *   session:{sessionId}    — Faculty + all students in that lecture
 *   user:{userId}          — Personal notifications (low attendance alert etc.)
 *   admin                  — Admin dashboard real-time feed
 */
const { Server }    = require('socket.io');
const { redisSub, CHANNELS } = require('../../config/redis');
const { verifyAccessToken }  = require('../../utils/jwt');
const logger        = require('../../utils/logger');

let io;

function initializeWebSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin:      process.env.FRONTEND_URL || 'http://localhost:5173',
      methods:     ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // ── Auth middleware for socket connections ──────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const decoded = verifyAccessToken(token);
      socket.data.user = decoded;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  // ── Connection handler ──────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const { id: userId, role } = socket.data.user;
    logger.debug(`WS connected: user=${userId} role=${role}`);

    // Every user joins their personal room
    socket.join(`user:${userId}`);

    // Admins join the admin room
    if (role === 'admin') {
      socket.join('admin');
    }

    // Faculty/student joins a session room on demand
    socket.on('join:session', (sessionId) => {
      socket.join(`session:${sessionId}`);
      logger.debug(`User ${userId} joined session room: ${sessionId}`);
    });

    socket.on('leave:session', (sessionId) => {
      socket.leave(`session:${sessionId}`);
    });

    socket.on('disconnect', () => {
      logger.debug(`WS disconnected: user=${userId}`);
    });
  });

  // ── Subscribe to Redis pub/sub channels ────────────────────────────────────
  redisSub.subscribe(
    CHANNELS.ATTENDANCE_MARKED,
    CHANNELS.ATTENDANCE_FRAUD,
    CHANNELS.QR_ROTATED,
    CHANNELS.NOTIFICATION_SEND,
    (err, count) => {
      if (err) logger.error('Redis subscribe error:', err);
      else logger.info(`WebSocket service subscribed to ${count} Redis channels ✓`);
    }
  );

  redisSub.on('message', (channel, message) => {
    try {
      const payload = JSON.parse(message);
      handleRedisMessage(channel, payload);
    } catch (err) {
      logger.error('WS message parse error:', err);
    }
  });

  logger.info('WebSocket server initialized ✓');
  return io;
}

function handleRedisMessage(channel, payload) {
  switch (channel) {
    case CHANNELS.ATTENDANCE_MARKED:
      // Broadcast to the session room (faculty dashboard updates live)
      io.to(`session:${payload.sessionId}`).emit('attendance:marked', payload);
      // Also update admin dashboard
      io.to('admin').emit('attendance:marked', payload);
      break;

    case CHANNELS.ATTENDANCE_FRAUD:
      // Alert faculty immediately when a fraud attempt is detected
      io.to(`session:${payload.sessionId}`).emit('attendance:fraud', payload);
      io.to('admin').emit('attendance:fraud', payload);
      logger.warn('Fraud event broadcast:', payload);
      break;

    case CHANNELS.QR_ROTATED:
      // Push new QR to all faculty clients watching this session
      io.to(`session:${payload.sessionId}`).emit('qr:rotated', payload);
      break;

    case CHANNELS.NOTIFICATION_SEND:
      // Push personal notification to specific user
      io.to(`user:${payload.userId}`).emit('notification', payload);
      break;

    default:
      logger.debug(`Unhandled Redis channel: ${channel}`);
  }
}

/** Send a direct notification to a user (called from other services) */
function sendToUser(userId, event, data) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
}

/** Broadcast to all admins */
function broadcastToAdmins(event, data) {
  if (!io) return;
  io.to('admin').emit(event, data);
}

module.exports = { initializeWebSocket, sendToUser, broadcastToAdmins };
