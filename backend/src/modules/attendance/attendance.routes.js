/**
 * attendance.routes.js
 *
 * Faculty-only:
 *   POST   /api/attendance/sessions                         create session
 *   POST   /api/attendance/sessions/:sessionId/rotate      rotate QR token
 *   DELETE /api/attendance/sessions/:sessionId             end session
 *   GET    /api/attendance/sessions/:sessionId             get session records
 *   PUT    /api/attendance/sessions/:sessionId/manual      manual override
 *
 * Student-only:
 *   POST   /api/attendance/mark/qr                         scan QR
 *   POST   /api/attendance/mark/face                       face recognition
 *   GET    /api/attendance/students/:studentId/summary     personal summary
 *
 * Admin: inherits faculty access + student access
 */
const express    = require('express');
const controller = require('./attendance.controller');
const schemas    = require('./attendance.schema');
const validate   = require('../../middleware/validate');
const { protect, authorize, selfOrAdmin } = require('../../middleware/auth');
const { qrScan, aiService }              = require('../../middleware/rateLimit');

const router = express.Router();

// All attendance routes require auth
router.use(protect);

// ── Faculty / Admin routes ────────────────────────────────────────────────────
router.post('/sessions',
  authorize('faculty', 'admin'),
  validate(schemas.createSession),
  controller.createSession
);

router.post('/sessions/:sessionId/rotate',
  authorize('faculty', 'admin'),
  validate(schemas.sessionId),
  controller.rotateToken
);

router.delete('/sessions/:sessionId',
  authorize('faculty', 'admin'),
  validate(schemas.sessionId),
  controller.endSession
);

router.get('/sessions/:sessionId',
  authorize('faculty', 'admin'),
  validate(schemas.sessionId),
  controller.getSessionAttendance
);

router.put('/sessions/:sessionId/manual',
  authorize('faculty', 'admin'),
  validate(schemas.markManual),
  controller.markManual
);

// ── Student routes ────────────────────────────────────────────────────────────
router.post('/mark/qr',
  authorize('student'),
  qrScan,                         // 5 scans per minute per user
  validate(schemas.markViaQR),
  controller.markViaQR
);

router.post('/mark/face',
  authorize('student'),
  aiService,                      // 20 face requests per minute per user
  validate(schemas.markViaFace),
  controller.markViaFace
);

// Student can see own summary; faculty/admin can see any
router.get('/students/:studentId/summary',
  selfOrAdmin,
  validate(schemas.studentSummary),
  controller.getStudentSummary
);

module.exports = router;
