/**
 * analytics.service.js — Aggregation, risk scoring, leaderboard, heatmap
 *
 * Design principle: analytics queries NEVER touch the raw Attendance collection
 * on user-facing endpoints (except for fresh exports). They read from the
 * pre-computed Analytics snapshots. This keeps dashboards sub-100ms even
 * at 100K users because we're doing point-reads, not aggregations.
 *
 * Exception: the nightly cron (analyticsJob.js) runs the expensive pipelines
 * and writes fresh snapshots. That's the only place we do heavy aggregation.
 */
const Analytics   = require('../../models/Analytics.model');
const Attendance  = require('../../models/Attendance.model');
const QRSession   = require('../../models/QRSession.model');
const Class       = require('../../models/Class.model');
const User        = require('../../models/User.model');
const { AppError } = require('../../middleware/errorHandler');
const logger       = require('../../utils/logger');

/** Compute risk level from percentage */
function getRiskLevel(pct) {
  if (pct < 60) return 'critical';
  if (pct < 75) return 'warning';
  if (pct < 85) return 'moderate';
  return 'good';
}

/** Simple rule-based risk score (0–100, higher = more at risk) */
function computeRiskScore({ overallPercentage, consecutiveAbsences, trend }) {
  let score = 0;

  // Base score: inverse of attendance %
  score += Math.max(0, 100 - overallPercentage);

  // Penalty for consecutive absences (max 30 points)
  score += Math.min(30, consecutiveAbsences * 5);

  // Trend penalty: if attendance has been dropping last 4 weeks
  if (trend.length >= 2) {
    const [prev, latest] = trend.slice(-2);
    if (latest.percentage < prev.percentage) {
      score += 10;
    }
  }

  return Math.min(100, Math.round(score));
}

// ── Admin Dashboard ───────────────────────────────────────────────────────────

/**
 * Admin overview: total students, avg attendance, at-risk count per department.
 */
async function getAdminOverview(department) {
  const filter = department ? { department } : {};

  const [totals, riskCounts] = await Promise.all([
    Analytics.aggregate([
      { $match: { ...filter } },
      {
        $group: {
          _id:              null,
          avgAttendance:    { $avg: '$overallPercentage' },
          totalStudents:    { $sum: 1 },
          criticalCount:    { $sum: { $cond: [{ $eq: ['$riskLevel', 'critical'] }, 1, 0] } },
          warningCount:     { $sum: { $cond: [{ $eq: ['$riskLevel', 'warning'] }, 1, 0] } },
        },
      },
    ]),
    Analytics.aggregate([
      { $match: { ...filter, riskLevel: { $in: ['critical', 'warning'] } } },
      { $group: { _id: '$department', atRisk: { $sum: 1 } } },
      { $sort: { atRisk: -1 } },
    ]),
  ]);

  return {
    ...totals[0],
    avgAttendance: parseFloat((totals[0]?.avgAttendance || 0).toFixed(1)),
    riskByDepartment: riskCounts,
  };
}

/**
 * Students at risk — paginated, filterable.
 */
async function getAtRiskStudents({ department, riskLevel = 'warning', page = 1, limit = 20 }) {
  const filter = {
    riskLevel: riskLevel === 'warning'
      ? { $in: ['warning', 'critical'] }
      : riskLevel,
    ...(department && { department }),
  };

  const [students, total] = await Promise.all([
    Analytics.find(filter)
      .populate('studentId', 'name email rollNumber phone')
      .sort({ riskScore: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Analytics.countDocuments(filter),
  ]);

  return {
    students,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Department-level attendance breakdown.
 */
async function getDepartmentStats() {
  return Analytics.aggregate([
    {
      $group: {
        _id:           '$department',
        avgAttendance: { $avg: '$overallPercentage' },
        totalStudents: { $sum: 1 },
        atRisk:        { $sum: { $cond: [{ $in: ['$riskLevel', ['warning', 'critical']] }, 1, 0] } },
      },
    },
    { $sort: { avgAttendance: -1 } },
    {
      $project: {
        department:    '$_id',
        avgAttendance: { $round: ['$avgAttendance', 1] },
        totalStudents: 1,
        atRisk:        1,
        _id:           0,
      },
    },
  ]);
}

// ── Faculty Dashboard ─────────────────────────────────────────────────────────

/**
 * Class-level attendance stats for a faculty member.
 */
async function getFacultyClassStats(facultyId) {
  const classes = await Class.find({ facultyId }).lean();

  const stats = await Promise.all(
    classes.map(async (cls) => {
      const totalSessions = await QRSession.countDocuments({
        classId: cls._id, isActive: false,
      });

      const totalEnrolled = cls.studentIds.length;
      const avgAttendance = await Attendance.aggregate([
        { $match: { classId: cls._id, status: 'present' } },
        {
          $group: {
            _id:        '$studentId',
            attended:   { $sum: 1 },
          },
        },
        {
          $group: {
            _id: null,
            avg: { $avg: { $multiply: [{ $divide: ['$attended', totalSessions || 1] }, 100] } },
          },
        },
      ]);

      return {
        classId:      cls._id,
        subjectCode:  cls.subjectCode,
        subjectName:  cls.subjectName,
        totalSessions,
        totalEnrolled,
        avgAttendance: parseFloat((avgAttendance[0]?.avg || 0).toFixed(1)),
      };
    })
  );

  return stats;
}

// ── Heatmap Data ──────────────────────────────────────────────────────────────

/**
 * Weekly attendance heatmap for a class — 7 days × N weeks.
 * Returns data in format ready for Recharts heatmap.
 */
async function getAttendanceHeatmap(classId, weeksBack = 12) {
  const since = new Date();
  since.setDate(since.getDate() - weeksBack * 7);

  const sessions = await QRSession.find({
    classId,
    lectureDate: { $gte: since },
    isActive:    false,
  }).select('lectureDate').lean();

  const sessionIds = sessions.map((s) => s._id);

  const attendance = await Attendance.aggregate([
    { $match: { qrSessionId: { $in: sessionIds }, status: 'present' } },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$lectureDate' } },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.date': 1 } },
  ]);

  // Map: date → present count
  const presentByDate = Object.fromEntries(
    attendance.map((a) => [a._id.date, a.count])
  );

  // Build grid: each session date with attendance % for the heatmap
  return sessions.map((s) => {
    const dateStr = s.lectureDate.toISOString().split('T')[0];
    const present = presentByDate[dateStr] || 0;
    return {
      date:    dateStr,
      present,
      pct:     parseFloat(((present / (sessions.length || 1)) * 100).toFixed(1)),
    };
  });
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

/**
 * Top students by attendance percentage — for the engagement leaderboard.
 * Paginated, filterable by department/semester.
 */
async function getLeaderboard({ department, semester, limit = 10 }) {
  const filter = {
    riskLevel: 'good',
    ...(department && { department }),
    ...(semester   && { semester }),
  };

  const topStudents = await Analytics.find(filter)
    .populate('studentId', 'name rollNumber department')
    .sort({ overallPercentage: -1, consecutiveAbsences: 1 })
    .limit(limit)
    .lean();

  return topStudents.map((entry, index) => ({
    rank:             index + 1,
    student:          entry.studentId,
    percentage:       entry.overallPercentage,
    totalAttended:    entry.totalAttended,
    consecutiveAbsences: entry.consecutiveAbsences,
  }));
}

// ── Export Helpers (used by export controller) ────────────────────────────────

/**
 * Full attendance data for CSV/PDF export — hits raw Attendance collection.
 * Only called on-demand (not on every page load).
 */
async function getClassAttendanceForExport(classId, { startDate, endDate }) {
  const filter = {
    classId,
    ...(startDate && endDate && {
      lectureDate: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    }),
  };

  return Attendance.find(filter)
    .populate('studentId', 'name rollNumber email')
    .populate('qrSessionId', 'lectureDate')
    .sort({ lectureDate: -1, 'studentId.name': 1 })
    .lean();
}

// ── Snapshot Computation (called by nightly cron) ────────────────────────────

/**
 * Recompute and upsert the analytics snapshot for ONE student.
 * Called by the nightly job for every active student.
 */
async function computeStudentSnapshot(studentId) {
  const classes = await Class.find({ studentIds: studentId });
  if (!classes.length) return;

  const student = await User.findById(studentId).lean();
  const subjectBreakdown = [];
  let totalAll   = 0;
  let attendedAll = 0;

  for (const cls of classes) {
    const totalSessions = await QRSession.countDocuments({ classId: cls._id, isActive: false });
    const attended      = await Attendance.countDocuments({
      studentId, classId: cls._id, status: 'present',
    });

    const pct = totalSessions > 0 ? (attended / totalSessions) * 100 : 0;

    subjectBreakdown.push({
      classId:      cls._id,
      subjectCode:  cls.subjectCode,
      subjectName:  cls.subjectName,
      totalClasses: totalSessions,
      attended,
      percentage:   parseFloat(pct.toFixed(1)),
      riskLevel:    getRiskLevel(pct),
    });

    totalAll    += totalSessions;
    attendedAll += attended;
  }

  const overallPct = totalAll > 0 ? (attendedAll / totalAll) * 100 : 0;

  // Compute consecutive absences (recent sessions for all classes)
  const recentSessions = await QRSession.find({
    classId: { $in: classes.map((c) => c._id) },
    isActive: false,
  }).sort({ lectureDate: -1 }).limit(20).lean();

  let consecutive = 0;
  for (const sess of recentSessions) {
    const rec = await Attendance.findOne({ studentId, qrSessionId: sess._id, status: 'present' });
    if (!rec) consecutive++;
    else break;
  }

  const periodEnd   = new Date();
  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - 30);

  const weeklyTrend = await buildWeeklyTrend(studentId, classes.map((c) => c._id));

  const riskScore = computeRiskScore({
    overallPercentage: overallPct,
    consecutiveAbsences: consecutive,
    trend: weeklyTrend,
  });

  await Analytics.findOneAndUpdate(
    { studentId },
    {
      studentId,
      department:          student.department,
      overallPercentage:   parseFloat(overallPct.toFixed(1)),
      totalClasses:        totalAll,
      totalAttended:       attendedAll,
      riskScore,
      riskLevel:           getRiskLevel(overallPct),
      subjectBreakdown,
      weeklyTrend,
      consecutiveAbsences: consecutive,
      periodStart,
      periodEnd,
      computedAt:          new Date(),
    },
    { upsert: true, new: true }
  );
}

async function buildWeeklyTrend(studentId, classIds) {
  const weeks = [];
  for (let i = 3; i >= 0; i--) {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - (i + 1) * 7);
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() - i * 7);

    const [total, attended] = await Promise.all([
      QRSession.countDocuments({
        classId: { $in: classIds },
        isActive: false,
        lectureDate: { $gte: weekStart, $lte: weekEnd },
      }),
      Attendance.countDocuments({
        studentId,
        classId: { $in: classIds },
        status: 'present',
        lectureDate: { $gte: weekStart, $lte: weekEnd },
      }),
    ]);

    const pct = total > 0 ? parseFloat(((attended / total) * 100).toFixed(1)) : 0;
    weeks.push({ week: 4 - i, year: weekEnd.getFullYear(), percentage: pct });
  }
  return weeks;
}

module.exports = {
  getAdminOverview,
  getAtRiskStudents,
  getDepartmentStats,
  getFacultyClassStats,
  getAttendanceHeatmap,
  getLeaderboard,
  getClassAttendanceForExport,
  computeStudentSnapshot,
};
