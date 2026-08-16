/**
 * email.service.js — Transactional email via Nodemailer (SMTP / SendGrid)
 */
const nodemailer = require('nodemailer');
const logger     = require('../../utils/logger');
const env        = require('../../config/env');

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:   env.SMTP_HOST,
      port:   env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

/**
 * Send a low-attendance warning email to a student.
 * Called by the nightly analytics job when riskLevel === 'warning' | 'critical'.
 */
async function sendLowAttendanceAlert({ studentName, studentEmail, overallPct, subjects }) {
  if (!env.SMTP_HOST) {
    logger.warn('Email not configured — skipping alert for', studentEmail);
    return;
  }

  const subjectRows = subjects
    .filter((s) => s.isAtRisk)
    .map((s) => `<tr>
      <td>${s.subjectName}</td>
      <td>${s.subjectCode}</td>
      <td style="color:${s.percentage < 60 ? '#dc2626' : '#d97706'}">${s.percentage}%</td>
    </tr>`)
    .join('');

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto;">
      <h2 style="color:#1e40af">⚠️ Low Attendance Alert</h2>
      <p>Dear <strong>${studentName}</strong>,</p>
      <p>Your overall attendance has dropped to <strong>${overallPct}%</strong>, which is below the required 75%.</p>

      <h3>Subject Breakdown</h3>
      <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
        <tr style="background:#f1f5f9">
          <th>Subject</th><th>Code</th><th>Attendance</th>
        </tr>
        ${subjectRows}
      </table>

      <p style="margin-top:16px">Please contact your faculty to discuss attendance improvement plans.</p>
      <p style="color:#6b7280;font-size:12px">This is an automated message from the Attendance System.</p>
    </div>
  `;

  try {
    await getTransporter().sendMail({
      from:    `"Attendance System" <${env.FROM_EMAIL}>`,
      to:      studentEmail,
      subject: `⚠️ Attendance Alert: Your attendance is at ${overallPct}%`,
      html,
    });
    logger.info(`Low attendance email sent to: ${studentEmail}`);
  } catch (err) {
    logger.error('Email send failed:', { to: studentEmail, error: err.message });
  }
}

/**
 * Send a session summary to faculty after they end a lecture.
 */
async function sendSessionSummary({ facultyEmail, subjectName, date, present, total }) {
  if (!env.SMTP_HOST) return;

  const pct = total > 0 ? ((present / total) * 100).toFixed(1) : 0;

  await getTransporter().sendMail({
    from:    `"Attendance System" <${env.FROM_EMAIL}>`,
    to:      facultyEmail,
    subject: `Session Summary — ${subjectName} (${date})`,
    html: `
      <p>Session for <strong>${subjectName}</strong> completed.</p>
      <p>Present: <strong>${present}/${total}</strong> (${pct}%)</p>
    `,
  });
}

module.exports = { sendLowAttendanceAlert, sendSessionSummary };
