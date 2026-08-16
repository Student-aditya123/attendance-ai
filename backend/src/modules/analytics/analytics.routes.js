/**
 * analytics.routes.js
 *
 * GET /api/analytics/admin/overview               admin only
 * GET /api/analytics/admin/at-risk                admin only
 * GET /api/analytics/admin/departments            admin only
 * GET /api/analytics/faculty/classes              faculty only
 * GET /api/analytics/heatmap/:classId             faculty + admin
 * GET /api/analytics/leaderboard                  all authenticated
 * GET /api/analytics/export/:classId              faculty + admin
 */
const express    = require('express');
const controller = require('./analytics.controller');
const { protect, authorize } = require('../../middleware/auth');

const router = express.Router();

router.use(protect);

// Admin routes
router.get('/admin/overview',    authorize('admin'), controller.getAdminOverview);
router.get('/admin/at-risk',     authorize('admin'), controller.getAtRiskStudents);
router.get('/admin/departments', authorize('admin'), controller.getDepartmentStats);

// Faculty routes
router.get('/faculty/classes',   authorize('faculty', 'admin'), controller.getFacultyStats);

// Shared routes
router.get('/heatmap/:classId',  authorize('faculty', 'admin'), controller.getHeatmap);
router.get('/leaderboard',       controller.getLeaderboard);
router.get('/export/:classId',   authorize('faculty', 'admin'), controller.exportClassAttendance);

module.exports = router;
