/**
 * auth.routes.js
 *
 * Public:
 *   POST /api/auth/register
 *   POST /api/auth/login
 *   POST /api/auth/refresh
 *   POST /api/auth/logout
 *
 * Protected:
 *   GET  /api/auth/me
 *   PUT  /api/auth/change-password
 */
const express    = require('express');
const controller = require('./auth.controller');
const schemas    = require('./auth.schema');
const validate   = require('../../middleware/validate');
const { protect } = require('../../middleware/auth');
const { auth: authLimiter } = require('../../middleware/rateLimit');

const router = express.Router();

router.post('/register',
  authLimiter,
  validate(schemas.register),
  controller.register
);

router.post('/login',
  authLimiter,
  validate(schemas.login),
  controller.login
);

router.post('/refresh',
  controller.refresh
);

router.post('/logout',
  controller.logout
);

// Protected routes
router.get('/me',
  protect,
  controller.getMe
);

router.put('/change-password',
  protect,
  validate(schemas.changePassword),
  controller.changePassword
);

module.exports = router;
