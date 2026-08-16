/**
 * sms.service.js — SMS alerts via Twilio
 *
 * Only sends SMS for CRITICAL risk level (< 60%) to avoid alert fatigue.
 * Email handles the warning (60-74%) level.
 */
const logger = require('../../utils/logger');
const env    = require('../../config/env');

let twilioClient;

function getTwilioClient() {
  if (!twilioClient && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
    const twilio  = require('twilio');
    twilioClient  = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

/**
 * Send critical attendance SMS alert.
 */
async function sendCriticalAttendanceSMS({ studentName, studentPhone, overallPct }) {
  const client = getTwilioClient();
  if (!client) {
    logger.warn('Twilio not configured — skipping SMS for', studentName);
    return;
  }

  const body = `⚠️ CRITICAL: ${studentName}, your attendance has fallen to ${overallPct}%. ` +
               `Please contact your department immediately to avoid academic consequences.`;

  try {
    const message = await client.messages.create({
      body,
      from: env.TWILIO_FROM_NUMBER,
      to:   studentPhone,
    });
    logger.info(`Critical SMS sent: sid=${message.sid} to=${studentPhone}`);
  } catch (err) {
    logger.error('SMS send failed:', { to: studentPhone, error: err.message });
  }
}

module.exports = { sendCriticalAttendanceSMS };
