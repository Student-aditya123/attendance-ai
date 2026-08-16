/**
 * attendance.controller.js — HTTP layer for attendance operations
 *
 * All heavy logic lives in attendance.service.js and qr.service.js.
 * Controllers only: extract → call → respond.
 */
const attendanceService = require('./attendance.service');
const qrService         = require('./qr.service');
const { asyncHandler }  = require('../../middleware/errorHandler');

// ── QR Session Management (Faculty) ──────────────────────────────────────────

/** POST /api/attendance/sessions — start a new lecture QR session */
const createSession = asyncHandler(async (req, res) => {
  const facultyId = req.user._id.toString();
  const { classId, latitude, longitude, radiusMeters, durationMinutes } = req.body;

  const { session, qrDataUri } = await qrService.createSession(
    classId, facultyId,
    { latitude, longitude, radiusMeters, durationMinutes }
  );

  res.status(201).json({
    success: true,
    message: 'Attendance session started',
    data: {
      sessionId:   session._id,
      expiresAt:   session.expiresAt,
      tokenTtlSecs: session.tokenTtlSecs,
      qrDataUri,
    },
  });
});

/** POST /api/attendance/sessions/:sessionId/rotate — rotate the QR token */
const rotateToken = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const { qrDataUri, nonce } = await qrService.rotateToken(sessionId);

  res.status(200).json({
    success: true,
    data: { qrDataUri, expiresIn: process.env.QR_TOKEN_TTL_SECS || 45 },
  });
});

/** DELETE /api/attendance/sessions/:sessionId — end the lecture session */
const endSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const result = await qrService.endSession(sessionId, req.user._id.toString());

  res.status(200).json({ success: true, data: result });
});

// ── Attendance Marking (Student) ──────────────────────────────────────────────

/** POST /api/attendance/mark/qr — student scans QR */
const markViaQR = asyncHandler(async (req, res) => {
  const studentId = req.user._id.toString();
  const { sessionId, scannedToken, latitude, longitude } = req.body;
  const deviceId  = req.headers['x-device-fingerprint'];
  const ipAddress = req.ip;

  const record = await attendanceService.markViaQR(studentId, {
    sessionId, scannedToken, latitude, longitude, deviceId, ipAddress,
  });

  res.status(201).json({
    success: true,
    message: '✅ Attendance marked successfully',
    data: { record },
  });
});

/** POST /api/attendance/mark/face — student marks via face recognition */
const markViaFace = asyncHandler(async (req, res) => {
  const studentId = req.user._id.toString();
  const { sessionId, imageBase64, latitude, longitude } = req.body;
  const deviceId  = req.headers['x-device-fingerprint'];

  const record = await attendanceService.markViaFace(studentId, {
    sessionId, imageBase64, latitude, longitude, deviceId,
  });

  res.status(201).json({
    success: true,
    message: '✅ Face recognition successful. Attendance marked.',
    data: { record },
  });
});

/** PUT /api/attendance/sessions/:sessionId/manual — faculty manually overrides */
const markManual = asyncHandler(async (req, res) => {
  const facultyId = req.user._id.toString();
  const { sessionId } = req.params;
  const { studentId, status, note } = req.body;

  const record = await attendanceService.markManual(facultyId, {
    sessionId, studentId, status, note,
  });

  res.status(200).json({
    success: true,
    message: 'Attendance record updated',
    data: { record },
  });
});

// ── Queries ───────────────────────────────────────────────────────────────────

/** GET /api/attendance/sessions/:sessionId — get session attendance list (faculty) */
const getSessionAttendance = asyncHandler(async (req, res) => {
  const records = await attendanceService.getSessionAttendance(req.params.sessionId);

  res.status(200).json({
    success: true,
    data: { count: records.length, records },
  });
});

/** GET /api/attendance/students/:studentId/summary — student's personal summary */
const getStudentSummary = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const { semester, department } = req.query;

  const summary = await attendanceService.getStudentSummary(studentId, { semester, department });

  res.status(200).json({
    success: true,
    data: summary,
  });
});

module.exports = {
  createSession, rotateToken, endSession,
  markViaQR, markViaFace, markManual,
  getSessionAttendance, getStudentSummary,
};
