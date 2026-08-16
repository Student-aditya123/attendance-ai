/**
 * redis.js — Redis client manager
 *
 * We export TWO clients:
 *   • redis      — general purpose (cache, QR blacklist, rate limiting)
 *   • redisPub   — publisher for WebSocket events
 *   • redisSub   — subscriber (separate connection required by Redis protocol)
 *
 * ioredis handles reconnection automatically.
 */
const Redis  = require('ioredis');
const logger = require('../utils/logger');
const env    = require('./env');

const clientOptions = {
  lazyConnect:    true,
  retryStrategy: (times) => Math.min(times * 100, 3000),
  maxRetriesPerRequest: 3,
};

const redis    = new Redis(env.REDIS_URL, clientOptions);
const redisPub = new Redis(env.REDIS_URL, clientOptions);
const redisSub = new Redis(env.REDIS_URL, clientOptions);

async function connectRedis() {
  await Promise.all([redis.connect(), redisPub.connect(), redisSub.connect()]);
  logger.info('Redis connected (×3 clients) ✓');
}

redis.on('error',    (err) => logger.error('Redis error:', err));
redisPub.on('error', (err) => logger.error('Redis pub error:', err));
redisSub.on('error', (err) => logger.error('Redis sub error:', err));

/** Pub/Sub channel names — shared constants prevent typos */
const CHANNELS = {
  ATTENDANCE_MARKED:  'attendance:marked',
  ATTENDANCE_FRAUD:   'attendance:fraud',
  QR_ROTATED:         'attendance:qr_rotated',
  NOTIFICATION_SEND:  'notifications:send',
};

module.exports = { redis, redisPub, redisSub, connectRedis, CHANNELS };
