/**
 * Analytics.model.js
 *
 * Pre-computed analytics snapshots — computed by the nightly cron job.
 * This is a read-heavy collection: dashboard queries hit this, NOT
 * the attendance collection directly. That keeps dashboards fast.
 *
 * Risk levels:
 *   critical  < 60% attendance
 *   warning   60–74%
 *   moderate  75–84%
 *   good      ≥ 85%
 */
const mongoose = require('mongoose');

const subjectBreakdownSchema = new mongoose.Schema(
  {
    classId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
    subjectCode:   { type: String },
    subjectName:   { type: String },
    totalClasses:  { type: Number, default: 0 },
    attended:      { type: Number, default: 0 },
    percentage:    { type: Number, default: 0 },
    riskLevel:     { type: String, enum: ['good', 'moderate', 'warning', 'critical'] },
  },
  { _id: false }
);

const analyticsSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    department:   { type: String },
    semester:     { type: Number },

    // Aggregate across all subjects
    overallPercentage: { type: Number, default: 0 },
    totalClasses:      { type: Number, default: 0 },
    totalAttended:     { type: Number, default: 0 },

    // ML model output (0–100, higher = more at risk)
    riskScore: { type: Number, default: 0, min: 0, max: 100 },
    riskLevel: {
      type: String,
      enum: ['good', 'moderate', 'warning', 'critical'],
      default: 'good',
    },

    // Per-subject breakdown for the student dashboard chart
    subjectBreakdown: [subjectBreakdownSchema],

    // Trend: last 4 weeks attendance %
    weeklyTrend: [{ week: Number, year: Number, percentage: Number }],

    // Consecutive absences (key fraud + risk signal)
    consecutiveAbsences: { type: Number, default: 0 },

    // Notification state
    lastAlertSentAt: { type: Date },
    alertCount:      { type: Number, default: 0 },

    // Period this snapshot covers
    periodStart: { type: Date, required: true },
    periodEnd:   { type: Date, required: true },
    computedAt:  { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
// Latest snapshot per student
analyticsSchema.index({ studentId: 1, computedAt: -1 });

// Admin dashboard: "show me all at-risk students in dept X"
analyticsSchema.index({ department: 1, riskLevel: 1, computedAt: -1 });

// Leaderboard: top students by attendance
analyticsSchema.index({ overallPercentage: -1, department: 1 });

module.exports = mongoose.model('Analytics', analyticsSchema);
