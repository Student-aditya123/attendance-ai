/**
 * modules/notifications/notification.routes.js
 *
 * Notification management API — send, bulk-alert, history.
 *
 * Routes:
 *   POST   /api/notifications/send              Admin  — push to specific user via WebSocket
 *   POST   /api/notifications/bulk-alert        Admin  — email/SMS all at-risk students
 *   GET    /api/notifications/history/:userId   Self   — alert history for a student
 *   POST   /api/notifications/test-email        Admin  — send test email to verify SMTP
 *   GET    /api/notifications/status            Admin  — notification service health
 */

const express    = require('express');
const { z }      = require('zod');
const Analytics  = require('../../models/Analytics.model');
const User       = require('../../models/User.model');
const { sendLowAttendanceAlert }    = require('./email.service');
const { sendCriticalAttendanceSMS } = require('./sms.service');
const { redisPub, CHANNELS }        = require('../../config/redis');
const validate   = require('../../middleware/validate');
const { protect, authorize, selfOrAdmin } = require('../../middleware/auth');
const { asyncHandler, AppError }    = require('../../middleware/errorHandler');
const logger     = require('../../utils/logger');

const router   = express.Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ObjectId');

// Apply auth to all routes
router.use(protect);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/notifications/send
// Push a manual WebSocket notification to a specific user
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/send',
  authorize('admin'),
  validate(z.object({
    body: z.object({
      userId:  objectId,
      type:    z.string().min(1).max(50),
      message: z.string().min(1).max(500),
      level:   z.enum(['info', 'warning', 'critical']).default('info'),
    }),
  })),
  asyncHandler(async (req, res) => {
    const { userId, type, message, level } = req.body;

    // Verify target user exists
    const user = await User.findById(userId).select('name email').lean();
    if (!user) throw new AppError('Target user not found', 404);

    // Publish to Redis → WebSocket service broadcasts to the user's room
    await redisPub.publish(
      CHANNELS.NOTIFICATION_SEND,
      JSON.stringify({
        userId,
        type,
        message,
        level,
        sentBy:  req.user._id.toString(),
        sentAt:  new Date().toISOString(),
      })
    );

    logger.info(
      `Manual notification sent to ${user.email} (${level}) by ${req.user.email}: "${message}"`
    );

    res.status(200).json({
      success: true,
      message: `Notification dispatched to ${user.name} via WebSocket`,
      data:    { userId, type, level },
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/notifications/bulk-alert
// Send email/SMS alerts to all at-risk students in a department/risk level
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/bulk-alert',
  authorize('admin'),
  validate(z.object({
    body: z.object({
      department: z.string().optional(),
      riskLevel:  z.enum(['warning', 'critical']).default('warning'),
      channel:    z.enum(['email', 'sms', 'both', 'websocket']).default('email'),
      dryRun:     z.boolean().default(false), // preview without actually sending
    }),
  })),
  asyncHandler(async (req, res) => {
    const { department, riskLevel, channel, dryRun } = req.body;

    // Build filter — 'warning' level includes both warning and critical
    const riskFilter = riskLevel === 'critical'
      ? ['critical']
      : ['warning', 'critical'];

    const filter = {
      riskLevel:  { $in: riskFilter },
      ...(department && { department }),
    };

    // Load at-risk snapshots with student contact info
    const snapshots = await Analytics.find(filter)
      .populate('studentId', 'name email phone')
      .lean();

    if (!snapshots.length) {
      return res.status(200).json({
        success: true,
        message: 'No at-risk students found matching the criteria',
        data:    { sent: 0, skipped: 0, total: 0, dryRun },
      });
    }

    // Cooldown: don't re-alert a student within the last 3 days
    const COOLDOWN_DAYS = 3;
    const cooldownCutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000);

    let sent = 0, skipped = 0, failed = 0;
    const preview = []; // populated on dryRun

    for (const snap of snapshots) {
      const student = snap.studentId;
      if (!student) { skipped++; continue; }

      // Respect cooldown
      if (snap.lastAlertSentAt && new Date(snap.lastAlertSentAt) > cooldownCutoff) {
        skipped++;
        if (dryRun) {
          preview.push({
            student: student.name,
            email:   student.email,
            level:   snap.riskLevel,
            pct:     snap.overallPercentage,
            action:  'SKIP — cooldown active',
          });
        }
        continue;
      }

      if (dryRun) {
        preview.push({
          student: student.name,
          email:   student.email,
          level:   snap.riskLevel,
          pct:     snap.overallPercentage,
          action:  `WOULD SEND via ${channel}`,
        });
        sent++;
        continue;
      }

      try {
        // ── Email ─────────────────────────────────────────────────────────────
        if (channel === 'email' || channel === 'both') {
          await sendLowAttendanceAlert({
            studentName:  student.name,
            studentEmail: student.email,
            overallPct:   snap.overallPercentage,
            subjects:     snap.subjectBreakdown || [],
          });
        }

        // ── SMS (critical only, if phone available) ────────────────────────
        if (
          (channel === 'sms' || channel === 'both') &&
          snap.riskLevel === 'critical' &&
          student.phone
        ) {
          await sendCriticalAttendanceSMS({
            studentName:  student.name,
            studentPhone: student.phone,
            overallPct:   snap.overallPercentage,
          });
        }

        // ── WebSocket real-time push ─────────────────────────────────────────
        if (channel === 'websocket' || channel === 'both' || channel === 'email') {
          await redisPub.publish(
            CHANNELS.NOTIFICATION_SEND,
            JSON.stringify({
              userId:  student._id.toString(),
              type:    'LOW_ATTENDANCE',
              message: `Your attendance is at ${snap.overallPercentage}%. Minimum required: 75%.`,
              level:   snap.riskLevel,
              sentAt:  new Date().toISOString(),
            })
          );
        }

        // ── Update alert metadata (cooldown + count) ──────────────────────────
        await Analytics.findByIdAndUpdate(snap._id, {
          lastAlertSentAt: new Date(),
          $inc: { alertCount: 1 },
        });

        sent++;
      } catch (err) {
        logger.error(`Bulk alert failed for ${student.email}: ${err.message}`);
        failed++;
      }
    }

    logger.info(
      `Bulk alert by ${req.user.email}: sent=${sent} skipped=${skipped} failed=${failed} ` +
      `channel=${channel} dryRun=${dryRun}`
    );

    res.status(200).json({
      success: true,
      data: {
        sent,
        skipped,
        failed,
        total:  snapshots.length,
        dryRun,
        ...(dryRun && { preview }),
      },
      message: dryRun
        ? `Dry run complete — ${sent} alerts would be sent`
        : `Alerts sent: ${sent} delivered, ${skipped} skipped (cooldown), ${failed} failed`,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/notifications/history/:userId
// Returns alert history from the Analytics snapshot for a student
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/history/:userId',
  validate(z.object({ params: z.object({ userId: objectId }) })),
  selfOrAdmin,
  asyncHandler(async (req, res) => {
    const snap = await Analytics.findOne({ studentId: req.params.userId })
      .select('alertCount lastAlertSentAt riskLevel overallPercentage weeklyTrend subjectBreakdown')
      .lean();

    if (!snap) {
      return res.status(200).json({
        success: true,
        data: {
          alertCount:      0,
          lastAlertSentAt: null,
          riskLevel:       'good',
          overallPercentage: 0,
        },
      });
    }

    // Compute next eligible alert time (cooldown = 3 days)
    const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
    const nextEligible = snap.lastAlertSentAt
      ? new Date(new Date(snap.lastAlertSentAt).getTime() + COOLDOWN_MS)
      : null;
    const canAlertNow = !nextEligible || nextEligible <= new Date();

    res.status(200).json({
      success: true,
      data: {
        alertCount:        snap.alertCount || 0,
        lastAlertSentAt:   snap.lastAlertSentAt || null,
        nextEligibleAt:    nextEligible || null,
        canAlertNow,
        riskLevel:         snap.riskLevel,
        overallPercentage: snap.overallPercentage,
        subjectsAtRisk:    (snap.subjectBreakdown || []).filter(s => s.percentage < 75).length,
      },
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/notifications/test-email
// Send a test email to verify SMTP configuration is working
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/test-email',
  authorize('admin'),
  validate(z.object({
    body: z.object({
      to: z.string().email(),
    }),
  })),
  asyncHandler(async (req, res) => {
    const { to } = req.body;

    await sendLowAttendanceAlert({
      studentName:  'Test Student',
      studentEmail: to,
      overallPct:   62.5,
      subjects: [
        { subjectName: 'Test Subject', subjectCode: 'TS101', percentage: 55, isAtRisk: true },
      ],
    });

    logger.info(`Test email sent to ${to} by ${req.user.email}`);

    res.status(200).json({
      success: true,
      message: `Test email sent to ${to}. Check your inbox and spam folder.`,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/notifications/status
// Returns overall notification service health + stats
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/status',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const env = require('../../config/env');

    // Count at-risk students and recent alerts
    const [criticalCount, warningCount, recentAlerts] = await Promise.all([
      Analytics.countDocuments({ riskLevel: 'critical' }),
      Analytics.countDocuments({ riskLevel: 'warning' }),
      Analytics.countDocuments({
        lastAlertSentAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        services: {
          email: {
            configured: !!env.SMTP_HOST,
            host:        env.SMTP_HOST || 'not configured',
            from:        env.FROM_EMAIL,
          },
          sms: {
            configured: !!env.TWILIO_ACCOUNT_SID,
            provider:   env.TWILIO_ACCOUNT_SID ? 'Twilio' : 'not configured',
          },
          websocket: {
            configured: true,
            channel:    CHANNELS.NOTIFICATION_SEND,
          },
        },
        stats: {
          criticalStudents: criticalCount,
          warningStudents:  warningCount,
          alertsLast24h:    recentAlerts,
          cooldownDays:     3,
        },
      },
    });
  })
);

module.exports = router;