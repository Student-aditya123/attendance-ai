/**
 * QRSession.model.js
 *
 * Each QR session represents ONE active lecture.
 * A session contains many rotating QR tokens (handled by Redis), but
 * this document anchors the session with location, timing, and fraud log.
 *
 * The TTL index on expiresAt auto-deletes expired sessions — no cron needed.
 */
const mongoose = require('mongoose');

const fraudAttemptSchema = new mongoose.Schema(
  {
    studentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason:      { type: String },           // 'EXPIRED_TOKEN' | 'LOCATION_MISMATCH' | etc.
    deviceId:    { type: String },
    latitude:    { type: Number },
    longitude:   { type: Number },
    attemptedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const qrSessionSchema = new mongoose.Schema(
  {
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      required: true,
    },
    facultyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    lectureDate: { type: Date, required: true, default: Date.now },

    // Current active QR nonce (rotated every QR_TOKEN_TTL_SECS)
    // Also stored in Redis for fast blacklist lookup — Mongo is the audit log
    currentNonce: { type: String, required: true },
    tokenTtlSecs: { type: Number, default: 45 },

    // Classroom location for GPS validation
    latitude:      { type: Number, required: true },
    longitude:     { type: Number, required: true },
    radiusMeters:  { type: Number, default: 100 },

    // Session lifecycle
    isActive:  { type: Boolean, default: true },
    startedAt: { type: Date, default: Date.now },
    endedAt:   { type: Date },
    expiresAt: { type: Date, required: true },  // TTL index target

    // Students who have already scanned this session (prevents double-scan)
    scannedStudentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // Fraud audit log
    fraudAttempts: [fraudAttemptSchema],
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
qrSessionSchema.index({ classId: 1, isActive: 1 });
qrSessionSchema.index({ facultyId: 1, lectureDate: -1 });
qrSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });   // TTL auto-delete

module.exports = mongoose.model('QRSession', qrSessionSchema);
