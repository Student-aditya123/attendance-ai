/**
 * rateLimit.js — Redis-backed distributed rate limiting
 *
 * Why Redis-backed and not in-memory? In-memory limiters reset on every
 * container restart and don't work across multiple Node replicas.
 * Redis gives us a single counter shared across all instances.
 *
 * We define multiple limiters with different budgets:
 *   • general    — 100 req / 15 min per IP (all routes)
 *   • auth       — 10  req / 15 min per IP (login/register — brute force protection)
 *   • qrScan     — 5   req / 60 sec per user (anti-spam for QR scanning)
 *   • aiService  — 20  req / min  per user  (face recognition is expensive)
 */
// const redisClient = require('../config/redis');
const { rateLimit, ipKeyGenerator }= require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { redis }  = require('../config/redis');

function makeStore(prefix) {
  return new RedisStore({
    sendCommand: (...args) => redis.call(...args),
      //  sendCommand: (...args) => redisClient.sendCommand(args),
    prefix,
  });
}

const general = rateLimit({
  windowMs:         15 * 60 * 1000,   // 15 minutes
  max:              100,
  standardHeaders:  true,
  legacyHeaders:    false,
  store:            makeStore('rl:general:'),
  message:          { success: false, message: 'Too many requests. Try again later.' },
});

const auth = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              10,
  standardHeaders:  true,
  legacyHeaders:    false,
  store:            makeStore('rl:auth:'),
  message:          { success: false, message: 'Too many login attempts. Please wait 15 minutes.' },
  skipSuccessfulRequests: true,   // only failed attempts count
});

const qrScan = rateLimit({
  windowMs:         15 * 60 * 1000,    // 1 minute
  max:              100,
  standardHeaders:  true,
  legacyHeaders:    false,
  store:            makeStore('rl:qr:'),
  keyGenerator:     (req) => req.user ? req.user.id : ipKeyGenerator(req.ip),   // per-user, not per-IP
  message:          { success: false, message: 'Scanning too fast. Please wait.' },
});

const aiService = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              100,
  standardHeaders:  true,
  legacyHeaders:    false,
  store:            makeStore('rl:ai:'),
  keyGenerator:     (req) => req.user? req.user.id : ipKeyGenerator(req.ip),
  message:          { success: false, message: 'Face recognition limit reached. Please wait.' },
});

module.exports = { general, auth, qrScan, aiService };
