/**
 * class.routes.js — Academic class management API
 * See class.service.js for full business logic documentation.
 */
const express  = require('express');
const { z }    = require('zod');
const service  = require('./class.service');
const validate = require('../../middleware/validate');
const { protect, authorize, selfOrAdmin } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/errorHandler');

const router   = express.Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ObjectId');

router.use(protect);

// ── Class CRUD ────────────────────────────────────────────────────────────────
router.post('/',
  authorize('admin', 'faculty'),
  asyncHandler(async (req, res) => {
    const cls = await service.createClass(req.body, req.user);
    res.status(201).json({ success: true, data: { class: cls } });
  })
);

router.get('/', asyncHandler(async (req, res) => {
  const data = await service.listClasses(req.query);
  res.status(200).json({ success: true, data });
}));

router.get('/student/:studentId/timetable',
  selfOrAdmin,
  asyncHandler(async (req, res) => {
    const data = await service.getStudentTimetable(req.params.studentId);
    res.status(200).json({ success: true, data: { timetable: data } });
  })
);

router.get('/:classId', asyncHandler(async (req, res) => {
  const cls = await service.getClassById(req.params.classId);
  res.status(200).json({ success: true, data: { class: cls } });
}));

router.put('/:classId',
  authorize('admin', 'faculty'),
  asyncHandler(async (req, res) => {
    const cls = await service.updateClass(req.params.classId, req.body, req.user);
    res.status(200).json({ success: true, data: { class: cls } });
  })
);

router.delete('/:classId',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    await service.deactivateClass(req.params.classId);
    res.status(200).json({ success: true, message: 'Class deactivated' });
  })
);

// ── Enrollment ────────────────────────────────────────────────────────────────
router.post('/:classId/enroll',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await service.enrollStudents(req.params.classId, req.body.studentIds);
    res.status(200).json({ success: true, data: result });
  })
);

router.delete('/:classId/enroll/:studentId',
  authorize('admin', 'faculty'),
  asyncHandler(async (req, res) => {
    const result = await service.unenrollStudent(req.params.classId, req.params.studentId);
    res.status(200).json({ success: true, data: result });
  })
);

router.get('/:classId/students',
  authorize('admin', 'faculty'),
  asyncHandler(async (req, res) => {
    const data = await service.getEnrolledStudents(req.params.classId, req.query);
    res.status(200).json({ success: true, data });
  })
);

router.get('/:classId/stats',
  authorize('admin', 'faculty'),
  asyncHandler(async (req, res) => {
    const data = await service.getClassAttendanceStats(req.params.classId);
    res.status(200).json({ success: true, data });
  })
);

module.exports = router;
