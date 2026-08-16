/**
 * analyticsJob.js — Nightly background job (runs at 02:00 AM)
 *
 * What it does:
 *   1. Find all active students
 *   2. Recompute their analytics snapshot (attendance %, risk score, trend)
 *   3. Upsert the snapshot to the Analytics collection
 *   4. For at-risk students who haven't been alerted recently → send email/SMS
 *
 * Why nightly and not real-time? Aggregating across all sessions for all students
 * on every attendance mark would create a thundering herd at peak hours. A nightly
 * batch keeps the DB load flat. For truly real-time risk (rare edge case), we can
 * always query the raw Attendance collection on demand.
 *
 * Alerting cooldown: don't re-alert the same student more than once per 3 days
 * to prevent notification fatigue.
 */
const cron         = require('node-cron');
const User         = require('../models/User.model');
const Analytics    = require('../models/Analytics.model');
const { computeStudentSnapshot } = require('../modules/analytics/analytics.service');
const { sendLowAttendanceAlert } = require('../modules/notifications/email.service');
const { sendCriticalAttendanceSMS } = require('../modules/notifications/sms.service');
const { redisPub, CHANNELS }   = require('../config/redis');
const logger       = require('../utils/logger');

const ALERT_COOLDOWN_DAYS = 3;

async function runAnalyticsJob() {
  logger.info('Analytics cron job started ⏱');
  const startTime = Date.now();

  try {
    // Fetch all active students (process in chunks to avoid loading 100K users at once)
    const CHUNK_SIZE = 100;
    let skip = 0;
    let processed = 0;
    let alertsSent = 0;

    while (true) {
      const students = await User.find({ role: 'student', isActive: true })
        .select('_id email name phone')
        .skip(skip)
        .limit(CHUNK_SIZE)
        .lean();

      if (students.length === 0) break;

      // Process each student (sequential to avoid DB hammering)
      for (const student of students) {
        try {
          await computeStudentSnapshot(student._id.toString());

          // Check if alerts need to be sent
          const snapshot = await Analytics.findOne({ studentId: student._id })
            .select('riskLevel overallPercentage subjectBreakdown lastAlertSentAt alertCount')
            .lean();

          if (!snapshot) continue;

          const isAtRisk = ['warning', 'critical'].includes(snapshot.riskLevel);
          if (!isAtRisk) continue;

          // Check cooldown
          const cooldownMs  = ALERT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
          const lastAlert   = snapshot.lastAlertSentAt;
          const cooldownPassed = !lastAlert || (Date.now() - new Date(lastAlert).getTime() > cooldownMs);

          if (!cooldownPassed) continue;

          // Send email alert (warning + critical)
          await sendLowAttendanceAlert({
            studentName:  student.name,
            studentEmail: student.email,
            overallPct:   snapshot.overallPercentage,
            subjects:     snapshot.subjectBreakdown,
          });

          // Send SMS for critical only
          if (snapshot.riskLevel === 'critical' && student.phone) {
            await sendCriticalAttendanceSMS({
              studentName:  student.name,
              studentPhone: student.phone,
              overallPct:   snapshot.overallPercentage,
            });
          }

          // Update alert metadata
          await Analytics.findOneAndUpdate(
            { studentId: student._id },
            {
              lastAlertSentAt: new Date(),
              $inc: { alertCount: 1 },
            }
          );

          // Push real-time WS notification to the student
          await redisPub.publish(CHANNELS.NOTIFICATION_SEND, JSON.stringify({
            userId:  student._id.toString(),
            type:    'LOW_ATTENDANCE',
            message: `Your attendance is at ${snapshot.overallPercentage}%. Minimum required: 75%.`,
            level:   snapshot.riskLevel,
          }));

          alertsSent++;
        } catch (studentErr) {
          logger.error(`Snapshot failed for student ${student._id}:`, studentErr.message);
        }

        processed++;
      }

      skip += CHUNK_SIZE;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`Analytics job complete ✓ processed=${processed} alerts=${alertsSent} time=${duration}s`);

  } catch (err) {
    logger.error('Analytics job fatal error:', err);
  }
}

/**
 * Register the cron schedule. Called from server.js at boot.
 * Format: '0 2 * * *' = every day at 02:00 AM server time.
 */
function startAnalyticsJob() {
  cron.schedule('0 2 * * *', runAnalyticsJob, {
    scheduled: true,
    timezone:  'Asia/Kolkata',   // IST — change to your institution's timezone
  });
  logger.info('Analytics cron scheduled: daily at 02:00 AM IST ✓');
}

// Allow manual trigger (useful for seeding or testing)
module.exports = { startAnalyticsJob, runAnalyticsJob };
