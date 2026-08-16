/**
 * analytics.controller.js
 */
const analyticsService = require('./analytics.service');
const { asyncHandler }  = require('../../middleware/errorHandler');

const getAdminOverview = asyncHandler(async (req, res) => {
  const { department } = req.query;
  const data = await analyticsService.getAdminOverview(department);
  res.status(200).json({ success: true, data });
});

const getAtRiskStudents = asyncHandler(async (req, res) => {
  const { department, riskLevel, page, limit } = req.query;
  const data = await analyticsService.getAtRiskStudents({
    department,
    riskLevel,
    page:  parseInt(page  || 1),
    limit: parseInt(limit || 20),
  });
  res.status(200).json({ success: true, data });
});

const getDepartmentStats = asyncHandler(async (req, res) => {
  const data = await analyticsService.getDepartmentStats();
  res.status(200).json({ success: true, data });
});

const getFacultyStats = asyncHandler(async (req, res) => {
  const data = await analyticsService.getFacultyClassStats(req.user._id.toString());
  res.status(200).json({ success: true, data });
});

const getHeatmap = asyncHandler(async (req, res) => {
  const { classId } = req.params;
  const weeksBack   = parseInt(req.query.weeksBack || 12);
  const data        = await analyticsService.getAttendanceHeatmap(classId, weeksBack);
  res.status(200).json({ success: true, data });
});

const getLeaderboard = asyncHandler(async (req, res) => {
  const { department, semester, limit } = req.query;
  const data = await analyticsService.getLeaderboard({
    department,
    semester: semester ? parseInt(semester) : undefined,
    limit:    parseInt(limit || 10),
  });
  res.status(200).json({ success: true, data });
});

const exportClassAttendance = asyncHandler(async (req, res) => {
  const { classId } = req.params;
  const { startDate, endDate, format = 'json' } = req.query;

  const records = await analyticsService.getClassAttendanceForExport(classId, { startDate, endDate });

  if (format === 'csv') {
    const header = 'Name,Roll Number,Email,Date,Status,Method,Confidence\n';
    const rows   = records.map((r) =>
      `${r.studentId?.name},${r.studentId?.rollNumber},${r.studentId?.email},` +
      `${r.lectureDate?.toISOString().split('T')[0]},${r.status},${r.method},` +
      `${r.faceMatchConfidence ?? ''}`
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${classId}.csv"`);
    return res.send(header + rows.join('\n'));
  }

  res.status(200).json({ success: true, data: { count: records.length, records } });
});

module.exports = {
  getAdminOverview,
  getAtRiskStudents,
  getDepartmentStats,
  getFacultyStats,
  getHeatmap,
  getLeaderboard,
  exportClassAttendance,
};
