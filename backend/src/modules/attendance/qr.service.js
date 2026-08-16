/**
 * qr.service.js — QR token lifecycle management
 *
 * How QR anti-replay works:
 *  1. A session is created with a nonce stored in MongoDB (audit) + Redis (fast lookup)
 *  2. Every QR_TOKEN_TTL_SECS, a new nonce is generated and the old one blacklisted
 *  3. On scan: nonce is checked against Redis blacklist BEFORE MongoDB
 *  4. Once used, the nonce is added to the blacklist immediately (single-use)
 *
 * The blacklist TTL in Redis matches the QR TTL — expired tokens auto-clean.
 */
const QRCode    = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const jwt       = require('jsonwebtoken');
const QRSession = require('../../models/QRSession.model');
const { redis, redisPub, CHANNELS } = require('../../config/redis');
const env       = require('../../config/env');
const logger    = require('../../utils/logger');

const QR_BLACKLIST_PREFIX = 'qr:blacklist:';
const QR_SESSION_PREFIX   = 'qr:session:';

/**
 * Create a new lecture QR session.
 * Returns the session document and initial QR code as a data URI.
 */
async function createSession(classId, facultyId, { latitude, longitude, radiusMeters, durationMinutes = 90 }) {
  // Only one active session per class at a time
  await QRSession.updateMany({ classId, isActive: true }, { isActive: false });

  const nonce     = uuidv4();
  const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);

  const session = await QRSession.create({
    classId, facultyId,
    currentNonce: nonce,
    tokenTtlSecs: env.QR_TOKEN_TTL_SECS,
    latitude, longitude,
    radiusMeters:  radiusMeters ?? env.QR_LOCATION_RADIUS,
    expiresAt,
    lectureDate:   new Date(),
  });

  // Store session metadata in Redis for fast validation (no Mongo hit per scan)
  await redis.setex(
    `${QR_SESSION_PREFIX}${session._id}`,
    durationMinutes * 60,
    JSON.stringify({ classId, facultyId, latitude, longitude, radiusMeters: session.radiusMeters })
  );

  // Activate the first nonce
  await activateNonce(session._id.toString(), nonce);

  const qrDataUri = await generateQRDataUri(session._id.toString(), nonce, classId);

  logger.info(`QR session created: ${session._id} for class ${classId}`);
  return { session, qrDataUri };
}

/**
 * Rotate the QR token — called every QR_TOKEN_TTL_SECS by the faculty client.
 * The old nonce is blacklisted; a new one is activated.
 */
async function rotateToken(sessionId) {
  const session = await QRSession.findById(sessionId);
  if (!session || !session.isActive) {
    throw new Error('Session not found or ended');
  }

  const oldNonce = session.currentNonce;
  const newNonce = uuidv4();

  // Blacklist old nonce (TTL = double the QR interval for safety overlap)
  await blacklistNonce(oldNonce, env.QR_TOKEN_TTL_SECS * 2);

  // Activate new nonce
  await activateNonce(sessionId, newNonce);

  // Update session document
  await QRSession.findByIdAndUpdate(sessionId, { currentNonce: newNonce });

  const classId   = session.classId.toString();
  const qrDataUri = await generateQRDataUri(sessionId, newNonce, classId);

  // Broadcast rotation event to faculty client via WebSocket
  await redisPub.publish(CHANNELS.QR_ROTATED, JSON.stringify({
    sessionId,
    qrDataUri,
    expiresIn: env.QR_TOKEN_TTL_SECS,
  }));

  return { qrDataUri, nonce: newNonce };
}

/**
 * Validate a scanned QR token. Returns session metadata or throws.
 * This is called on every attendance scan — must be FAST.
 * Order of checks: Redis first (fast), Mongo second (authoritative).
 */
async function validateToken(sessionId, scannedNonce) {
  // 1. Check nonce is not blacklisted
  const isBlacklisted = await redis.exists(`${QR_BLACKLIST_PREFIX}${scannedNonce}`);
  if (isBlacklisted) {
    return { valid: false, reason: 'REPLAYED_TOKEN' };
  }

  // 2. Check active nonce from Redis
  const activeNonce = await redis.get(`qr:active:${sessionId}`);
  if (!activeNonce || activeNonce !== scannedNonce) {
    return { valid: false, reason: 'EXPIRED_OR_INVALID_TOKEN' };
  }

  // 3. Load session metadata from Redis (fast path — no Mongo)
  const sessionMeta = await redis.get(`${QR_SESSION_PREFIX}${sessionId}`);
  if (!sessionMeta) {
    // Fallback to Mongo if Redis cache expired
    const session = await QRSession.findById(sessionId);
    if (!session || !session.isActive) {
      return { valid: false, reason: 'SESSION_INACTIVE' };
    }
    return { valid: true, session };
  }

  return { valid: true, session: JSON.parse(sessionMeta) };
}

/**
 * Mark a nonce as used (single-use enforcement).
 * Called immediately after a successful attendance record.
 */
async function consumeNonce(nonce) {
  await blacklistNonce(nonce, env.QR_TOKEN_TTL_SECS);
}

/**
 * End a QR session (faculty closes the lecture).
 */
async function endSession(sessionId, facultyId) {
  const session = await QRSession.findOne({ _id: sessionId, facultyId, isActive: true });
  if (!session) throw new Error('Active session not found');

  await QRSession.findByIdAndUpdate(sessionId, {
    isActive: false,
    endedAt:  new Date(),
  });

  // Clean up Redis
  await redis.del(`${QR_SESSION_PREFIX}${sessionId}`);
  await redis.del(`qr:active:${sessionId}`);

  logger.info(`QR session ended: ${sessionId}`);
  return { message: 'Session ended' };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function activateNonce(sessionId, nonce) {
  await redis.setex(`qr:active:${sessionId}`, env.QR_TOKEN_TTL_SECS + 10, nonce);
}

async function blacklistNonce(nonce, ttlSecs) {
  await redis.setex(`${QR_BLACKLIST_PREFIX}${nonce}`, ttlSecs, '1');
}

async function generateQRDataUri(sessionId, nonce, classId) {
  // QR payload: a minimal signed JWT — not the session JWT (different purpose)
  const payload = jwt.sign(
    { sessionId, nonce, classId, iat: Math.floor(Date.now() / 1000) },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.QR_TOKEN_TTL_SECS }
  );
  return QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', width: 300 });
}

module.exports = { createSession, rotateToken, validateToken, consumeNonce, endSession };
