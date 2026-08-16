/**
 * auth.controller.js — HTTP handlers for auth routes
 *
 * Controllers are intentionally thin:
 *   1. Extract from req
 *   2. Call service
 *   3. Shape and send response
 *
 * Refresh token goes in an httpOnly cookie — JS can't read it,
 * so XSS attacks can't steal it. Access token is returned in the
 * response body and stored in memory (not localStorage) by the frontend.
 */
const authService = require('./auth.service');
const { asyncHandler } = require('../../middleware/errorHandler');
const env = require('../../config/env');

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge:   7 * 24 * 60 * 60 * 1000,  // 7 days
};

const register = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.register(req.body);

  res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);

  res.status(201).json({
    success: true,
    message: 'Registration successful',
    data: {
      user,
      accessToken,
    },
  });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const deviceFingerprint   = req.headers['x-device-fingerprint'];

  const { user, accessToken, refreshToken } = await authService.login(
    email, password, deviceFingerprint
  );

  res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);

  res.status(200).json({
    success: true,
    message: 'Login successful',
    data: {
      user,
      accessToken,
    },
  });
});

const refresh = asyncHandler(async (req, res) => {
  // Try cookie first, fallback to body (for mobile clients that can't use cookies)
  const token = req.cookies?.refreshToken || req.body.refreshToken;
  if (!token) {
    return res.status(401).json({ success: false, message: 'Refresh token not provided' });
  }

  const { accessToken, refreshToken } = await authService.refreshTokens(token);

  res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);

  res.status(200).json({
    success: true,
    data: { accessToken },
  });
});

const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken || req.body.refreshToken;

  if (token) {
    try { await authService.logout(token); } catch (_) { /* already expired, fine */ }
  }

  res.clearCookie('refreshToken');
  res.status(200).json({ success: true, message: 'Logged out successfully' });
});

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await authService.changePassword(req.user._id, currentPassword, newPassword);

  res.clearCookie('refreshToken');  // force re-login after password change
  res.status(200).json({ success: true, message: 'Password changed. Please log in again.' });
});

const getMe = asyncHandler(async (req, res) => {
  const user = await authService.getProfile(req.user._id);
  res.status(200).json({ success: true, data: { user } });
});

module.exports = { register, login, refresh, logout, changePassword, getMe };
