/**
 * auth.service.js — Authentication business logic
 *
 * Controller → Service → Model pattern.
 * The controller handles HTTP concerns (req/res).
 * The service handles business logic (can be tested without HTTP).
 */
const User    = require('../../models/User.model');
const jwtUtil = require('../../utils/jwt');
const logger  = require('../../utils/logger');
const { AppError } = require('../../middleware/errorHandler');

/**
 * Register a new user.
 * Password is set on passwordHash field — the pre-save hook bcrypts it.
 */
async function register(userData) {
  const existingUser = await User.findOne({ email: userData.email });
  if (existingUser) {
    throw new AppError('Email already registered', 409);
  }

  const user = await User.create({
    ...userData,
    passwordHash: userData.password,  // pre-save hook will hash this
  });

  logger.info(`New ${user.role} registered: ${user.email}`);

  const accessToken  = jwtUtil.signAccessToken(user.toJWTPayload());
  const refreshToken = await jwtUtil.signRefreshToken(user._id.toString());

  return { user, accessToken, refreshToken };
}

/**
 * Login with email + password.
 * Explicitly selects passwordHash which is normally excluded from queries.
 */
async function login(email, password, deviceFingerprint) {
  const user = await User.findOne({ email }).select('+passwordHash');

  if (!user) {
    throw new AppError('Invalid email or password', 401);
  }
  if (!user.isActive) {
    throw new AppError('Account is deactivated. Contact admin.', 403);
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    logger.warn(`Failed login attempt for: ${email}`);
    throw new AppError('Invalid email or password', 401);
  }

  // Update device fingerprint and last login
  await User.findByIdAndUpdate(user._id, {
    lastLoginAt:       new Date(),
    deviceFingerprint: deviceFingerprint || user.deviceFingerprint,
  });

  const accessToken  = jwtUtil.signAccessToken(user.toJWTPayload());
  const refreshToken = await jwtUtil.signRefreshToken(user._id.toString());

  logger.info(`Login successful: ${user.email} (${user.role})`);
  return { user, accessToken, refreshToken };
}

/**
 * Issue a new access token using a valid refresh token.
 * Old refresh token is revoked (rotation) to limit stolen-token window.
 */
async function refreshTokens(oldRefreshToken) {
  const decoded = await jwtUtil.verifyRefreshToken(oldRefreshToken);

  const user = await User.findById(decoded.userId);
  if (!user || !user.isActive) {
    throw new AppError('User not found or deactivated', 401);
  }

  const { accessToken, refreshToken } = await jwtUtil.rotateRefreshToken(
    oldRefreshToken,
    user.toJWTPayload()
  );

  return { accessToken, refreshToken };
}

/**
 * Logout: revoke the refresh token.
 * Access token expiry handles itself (15m TTL).
 */
async function logout(refreshToken) {
  const decoded = await jwtUtil.verifyRefreshToken(refreshToken);
  await jwtUtil.revokeRefreshToken(decoded.jti);
  logger.info(`User ${decoded.userId} logged out`);
}

/**
 * Change password (authenticated user only).
 */
async function changePassword(userId, currentPassword, newPassword) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw new AppError('User not found', 404);

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) throw new AppError('Current password is incorrect', 401);

  user.passwordHash = newPassword;  // pre-save hook re-hashes
  await user.save();

  logger.info(`Password changed for user: ${user.email}`);
}

/**
 * Get user profile.
 */
async function getProfile(userId) {
  const user = await User.findById(userId);
  if (!user) throw new AppError('User not found', 404);
  return user;
}

module.exports = { register, login, refreshTokens, logout, changePassword, getProfile };
