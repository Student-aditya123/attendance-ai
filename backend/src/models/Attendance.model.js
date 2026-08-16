/**
 * Attendance.model.js
 *
 * Each document = one student's attendance for one lecture.
 * The compound unique index (studentId + qrSessionId) is the database-level
 * guarantee against double-marking — the service layer checks first,
 * but the DB is the final arbiter.
 */
const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      required: true,
    },
    qrSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QRSession',
      required: true,
    },
    lectureDate: { type: Date, required: true },

    // How attendance was recorded
    method: {
      type: String,
      enum: ['qr', 'face', 'manual', 'biometric'],
      required: true,
    },

    // Face recognition result (null if method !== 'face')
    faceMatchConfidence: { type: Number, min: 0, max: 1, default: null },

    // Device + location snapshot at scan time
    deviceId:  { type: String },
    ipAddress: { type: String },
    latitude:  { type: Number },
    longitude: { type: Number },
    distanceFromClassroom: { type: Number },  // metres

    // Final status after all validations
    status: {
      type: String,
      enum: ['present', 'absent', 'late', 'excused', 'flagged'],
      default: 'present',
    },

    // Manual override by faculty
    markedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note:      { type: String, maxlength: 300 },

    markedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
// Unique guard: one record per student per session
attendanceSchema.index({ studentId: 1, qrSessionId: 1 }, { unique: true });

// Analytics queries: "all attendance for class X in date range"
attendanceSchema.index({ classId: 1, lectureDate: -1 });

// Student dashboard: "all my attendance"
attendanceSchema.index({ studentId: 1, lectureDate: -1 });

// Risk detection: find students with low attendance in a class
attendanceSchema.index({ classId: 1, studentId: 1, status: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
