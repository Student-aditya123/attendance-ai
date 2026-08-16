/**
 * auth.js — Authentication and authorisation middleware
 *
 * protect()        — verifies JWT, attaches req.user
 * authorize(...roles) — RBAC gate, must be called AFTER protect()
 *
 * Token extraction: Bearer header only (not cookies) for the API.
 * Refresh tokens travel in httpOnly cookies (set by the auth controller).
 */
const { verifyAccessToken } = require('../utils/jwt');
const User   = require('../models/User.model');
const logger = require('../utils/logger');

/**
 * Middleware: verify JWT and load the user into req.user
 */
async function protect(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Provide Bearer token.',
      });
    }

    const token   = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    // Load fresh user from DB — catches deactivated accounts mid-session
    const user = await User.findById(decoded.id).select('-passwordHash');
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'User not found or deactivated' });
    }

    req.user = user;
    next();
  } catch (err) {
    logger.warn('Auth failure:', { message: err.message, ip: req.ip });

    const message =
      err.name === 'TokenExpiredError' ? 'Token expired. Please refresh.' :
      err.name === 'JsonWebTokenError' ? 'Invalid token.' :
      'Authentication failed.';

    return res.status(401).json({ success: false, message });
  }
}

/**
 * Middleware factory: RBAC role gate
 *
 * Usage: router.get('/admin-only', protect, authorize('admin'), handler)
 *
 * @param {...string} roles — allowed role names
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthenticated' });
    }
    if (!roles.includes(req.user.role)) {
      logger.warn(`RBAC denied: user ${req.user._id} (${req.user.role}) tried ${req.method} ${req.originalUrl}`);
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(' or ')}.`,
      });
    }
    next();
  };
}

/**
 * Middleware: a student can only access their OWN records.
 * Attach this after protect() on student-specific endpoints.
 * Faculty and admin bypass this check.
 */
function selfOrAdmin(req, res, next) {
  const { user } = req;
  const targetId  = req.params.studentId || req.params.userId;

  if (user.role === 'admin' || user.role === 'faculty') return next();
  if (user._id.toString() === targetId) return next();

  return res.status(403).json({ success: false, message: 'You can only access your own records.' });
}

module.exports = { protect, authorize, selfOrAdmin };
