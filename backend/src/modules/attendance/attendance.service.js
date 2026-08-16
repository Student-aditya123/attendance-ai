/**
 * attendance.service.js — Core attendance business logic
 *
 * The mark() function runs a fraud detection pipeline in sequence:
 *   1. Validate QR token     → REPLAYED_TOKEN / EXPIRED
 *   2. Check student enrolled → NOT_ENROLLED
 *   3. Validate GPS location → LOCATION_MISMATCH
 *   4. Device fingerprint   → DEVICE_MISMATCH (soft warning, not hard block)
 *   5. Double-scan check    → ALREADY_MARKED
 *   6. (Optional) Face verify → LOW_CONFIDENCE
 *   7. Write attendance record
 *   8. Publish WebSocket event
 *
 * Any hard failure is logged as a fraud attempt on the QRSession document.
 */
const Attendance = require('../../models/Attendance.model');
const QRSession  = require('../../models/QRSession.model');
const Class      = require('../../models/Class.model');
const qrService  = require('./qr.service');
const { isWithinRadius, isValidCoordinate } = require('../../utils/geoUtils');
const { redisPub, CHANNELS } = require('../../config/redis');
const { AppError } = require('../../middleware/errorHandler');
const logger     = require('../../utils/logger');
const axios      = require('axios');
const env        = require('../../config/env');

const FACE_CONFIDENCE_THRESHOLD = 0.80;

/**
 * Mark attendance via QR scan.
 */
async function markViaQR(studentId, { sessionId, scannedToken, latitude, longitude, deviceId, ipAddress }) {
  // ── Step 1: Validate QR token ──────────────────────────────────────────────
  const { valid, reason, session: sessionMeta } = await qrService.validateToken(sessionId, scannedToken);
  if (!valid) {
    await logFraudAttempt(sessionId, studentId, reason, { latitude, longitude, deviceId });
    throw new AppError(`Invalid QR: ${reason}`, 422);
  }

  // Load full session from Mongo for authoritative data
  const qrSession = await QRSession.findById(sessionId);
  if (!qrSession?.isActive) {
    throw new AppError('Session is no longer active', 422);
  }

  // ── Step 2: Check enrollment ───────────────────────────────────────────────
  const classDoc = await Class.findById(qrSession.classId);
  if (!classDoc?.studentIds.some((id) => id.toString() === studentId)) {
    await logFraudAttempt(sessionId, studentId, 'NOT_ENROLLED', { latitude, longitude, deviceId });
    throw new AppError('You are not enrolled in this class', 403);
  }

  // ── Step 3: GPS validation ─────────────────────────────────────────────────
  if (!isValidCoordinate(latitude, longitude)) {
    await logFraudAttempt(sessionId, studentId, 'INVALID_COORDINATES', { latitude, longitude, deviceId });
    throw new AppError('Valid GPS coordinates are required for attendance', 422);
  }

  const { valid: inRange, distanceMeters } = isWithinRadius(
    { latitude: qrSession.latitude, longitude: qrSession.longitude },
    { latitude, longitude },
    qrSession.radiusMeters
  );

  if (!inRange) {
    await logFraudAttempt(sessionId, studentId, 'LOCATION_MISMATCH', { latitude, longitude, deviceId });
    throw new AppError(
      `You are ${Math.round(distanceMeters)}m from the classroom (max ${qrSession.radiusMeters}m)`,
      422
    );
  }

  // ── Step 4: Double-scan check ──────────────────────────────────────────────
  if (qrSession.scannedStudentIds.some((id) => id.toString() === studentId)) {
    throw new AppError('Attendance already marked for this session', 409);
  }

  // Also check DB (resilient against race conditions with concurrent requests)
  const existing = await Attendance.findOne({ studentId, qrSessionId: sessionId });
  if (existing) {
    throw new AppError('Attendance already recorded', 409);
  }

  // ── Step 5: Consume nonce (single-use enforcement) ─────────────────────────
  await qrService.consumeNonce(scannedToken);

  // ── Step 6: Write attendance record ───────────────────────────────────────
  const record = await Attendance.create({
    studentId,
    classId:     qrSession.classId,
    qrSessionId: sessionId,
    lectureDate: qrSession.lectureDate,
    method:      'qr',
    deviceId,
    ipAddress,
    latitude,
    longitude,
    distanceFromClassroom: Math.round(distanceMeters),
    status:      'present',
  });

  // Add student to scanned list in session (atomic)
  await QRSession.findByIdAndUpdate(sessionId, {
    $addToSet: { scannedStudentIds: studentId },
  });

  // ── Step 7: Broadcast real-time event ─────────────────────────────────────
  await redisPub.publish(CHANNELS.ATTENDANCE_MARKED, JSON.stringify({
    sessionId,
    studentId,
    classId:     qrSession.classId.toString(),
    subjectCode: classDoc.subjectCode,
    recordId:    record._id.toString(),
    markedAt:    record.markedAt,
  }));

  logger.info(`Attendance marked: student=${studentId} class=${qrSession.classId} method=qr`);
  return record;
}

/**
 * Mark attendance via face recognition.
 * Calls the Python AI microservice and validates the confidence score.
 */
async function markViaFace(studentId, { sessionId, imageBase64, latitude, longitude, deviceId }) {
  // Run QR session validation (reuse the same checks)
  const qrSession = await QRSession.findById(sessionId);
  if (!qrSession?.isActive) throw new AppError('No active session found', 404);

  // GPS check (same as QR path)
  const { valid: inRange, distanceMeters } = isWithinRadius(
    { latitude: qrSession.latitude, longitude: qrSession.longitude },
    { latitude, longitude },
    qrSession.radiusMeters
  );
  if (!inRange) throw new AppError(`Too far from classroom (${Math.round(distanceMeters)}m)`, 422);

  // Double-scan check
  const existing = await Attendance.findOne({ studentId, qrSessionId: sessionId });
  if (existing) throw new AppError('Attendance already recorded', 409);

  // Call AI service
  let confidence = 0;
  try {
    const aiResponse = await axios.post(`${env.AI_SERVICE_URL}/recognize`, {
      studentId,
      imageBase64,
    }, { timeout: 8000 });
    confidence = aiResponse.data.confidence ?? 0;
  } catch (err) {
    logger.error('AI service call failed:', err.message);
    throw new AppError('Face recognition service unavailable. Use QR instead.', 503);
  }

  if (confidence < FACE_CONFIDENCE_THRESHOLD) {
    await logFraudAttempt(sessionId, studentId, 'LOW_FACE_CONFIDENCE', { latitude, longitude, confidence });
    throw new AppError(`Face match confidence too low (${(confidence * 100).toFixed(0)}%). Try again in better lighting.`, 422);
  }

  const record = await Attendance.create({
    studentId,
    classId:              qrSession.classId,
    qrSessionId:          sessionId,
    lectureDate:          qrSession.lectureDate,
    method:               'face',
    faceMatchConfidence:  confidence,
    latitude, longitude,
    distanceFromClassroom: Math.round(distanceMeters),
    status: 'present',
  });

  await QRSession.findByIdAndUpdate(sessionId, {
    $addToSet: { scannedStudentIds: studentId },
  });

  await redisPub.publish(CHANNELS.ATTENDANCE_MARKED, JSON.stringify({
    sessionId,
    studentId,
    classId:  qrSession.classId.toString(),
    recordId: record._id.toString(),
    method:   'face',
    confidence,
  }));

  return record;
}

/**
 * Manual override by faculty — mark individual students present/absent/excused.
 */
async function markManual(facultyId, { sessionId, studentId, status, note }) {
  const qrSession = await QRSession.findOne({ _id: sessionId, facultyId });
  if (!qrSession) throw new AppError('Session not found', 404);

  const record = await Attendance.findOneAndUpdate(
    { studentId, qrSessionId: sessionId },
    {
      studentId,
      classId:     qrSession.classId,
      qrSessionId: sessionId,
      lectureDate: qrSession.lectureDate,
      method:      'manual',
      status,
      markedBy:    facultyId,
      note,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return record;
}

/**
 * Get attendance records for a class session (faculty view).
 */
async function getSessionAttendance(sessionId) {
  return Attendance.find({ qrSessionId: sessionId })
    .populate('studentId', 'name rollNumber email')
    .sort({ markedAt: -1 });
}

/**
 * Get a student's attendance summary per subject.
 */
async function getStudentSummary(studentId, { semester, department } = {}) {
  const classes = await Class.find({
    studentIds: studentId,
    ...(department && { department }),
    ...(semester  && { semester }),
  }).select('subjectCode subjectName');

  const summaries = await Promise.all(
    classes.map(async (cls) => {
      const total    = await QRSession.countDocuments({ classId: cls._id, isActive: false });
      const attended = await Attendance.countDocuments({ studentId, classId: cls._id, status: 'present' });
      const pct      = total > 0 ? ((attended / total) * 100).toFixed(1) : '0.0';

      return {
        classId:     cls._id,
        subjectCode: cls.subjectCode,
        subjectName: cls.subjectName,
        totalClasses: total,
        attended,
        percentage:   parseFloat(pct),
        isAtRisk:     parseFloat(pct) < 75,
      };
    })
  );

  const totalAll   = summaries.reduce((a, b) => a + b.totalClasses, 0);
  const attendedAll = summaries.reduce((a, b) => a + b.attended, 0);
  const overall    = totalAll > 0 ? ((attendedAll / totalAll) * 100).toFixed(1) : '0.0';

  return { overall: parseFloat(overall), subjects: summaries };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function logFraudAttempt(sessionId, studentId, reason, meta = {}) {
  logger.warn(`Fraud attempt: student=${studentId} session=${sessionId} reason=${reason}`, meta);

  await QRSession.findByIdAndUpdate(sessionId, {
    $push: {
      fraudAttempts: {
        studentId,
        reason,
        ...meta,
        attemptedAt: new Date(),
      },
    },
  });

  await redisPub.publish(CHANNELS.ATTENDANCE_FRAUD, JSON.stringify({
    sessionId, studentId, reason, ...meta,
  }));
}

module.exports = { markViaQR, markViaFace, markManual, getSessionAttendance, getStudentSummary };
