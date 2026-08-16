/**
 * jwt.js — Token management
 *
 * Two-token strategy:
 *   • Access token  (15m)  — sent on every request, short-lived
 *   • Refresh token (7d)   — stored in httpOnly cookie, used to re-issue access tokens
 *
 * Why two tokens? If an access token leaks, attacker window is ≤15 minutes.
 * The refresh token can be revoked by removing it from Redis.
 */
const jwt    = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const env    = require('../config/env');
const { redis } = require('../config/redis');
const logger = require('./logger');

const REFRESH_PREFIX = 'refresh:';

/**
 * Issue an access JWT containing the user's id, role, and email.
 * We keep the payload minimal — no PII that shouldn't leave the server often.
 */
function signAccessToken(payload) {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
    issuer:    'attendance-api',
    audience:  'attendance-client',
  });
}

/**
 * Issue a refresh token (UUID stored in Redis → Redis is our revocation list).
 * The token itself holds only the userId so we can look up the Redis entry.
 */
async function signRefreshToken(userId) {
  const jti = uuidv4();  // unique token ID for revocation

  const token = jwt.sign(
    { sub: userId, jti },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_TTL, issuer: 'attendance-api' }
  );

  // Store jti in Redis with same TTL — revocation = delete this key
  const ttlSeconds = 7 * 24 * 60 * 60; // 7 days
  await redis.set(`${REFRESH_PREFIX}${jti}`, userId, 'EX', ttlSeconds);

  return token;
}

/**
 * Verify an access token. Returns decoded payload or throws.
 */
function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer:   'attendance-api',
    audience: 'attendance-client',
  });
}

/**
 * Verify a refresh token AND confirm its jti is still in Redis.
 * This is what makes logout and token rotation work correctly.
 */
async function verifyRefreshToken(token) {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, {
    issuer: 'attendance-api',
  });

  const storedUserId = await redis.get(`${REFRESH_PREFIX}${decoded.jti}`);
  if (!storedUserId) {
    throw new Error('Refresh token revoked or expired');
  }

  return { ...decoded, userId: storedUserId };
}

/**
 * Revoke a refresh token (logout). Deletes from Redis immediately.
 */
async function revokeRefreshToken(jti) {
  const deleted = await redis.del(`${REFRESH_PREFIX}${jti}`);
  logger.debug(`Refresh token ${jti} revoked (deleted=${deleted})`);
}

/**
 * Rotate: revoke old refresh token and issue a new pair.
 * Called by the /auth/refresh endpoint.
 */
async function rotateRefreshToken(oldToken, userPayload) {
  const decoded    = await verifyRefreshToken(oldToken);
  await revokeRefreshToken(decoded.jti);

  const accessToken  = signAccessToken(userPayload);
  const refreshToken = await signRefreshToken(userPayload.id);

  return { accessToken, refreshToken };
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
};
