/**
 * env.js — Centralised environment validation
 *
 * Why Zod here? If a secret is missing, we want a clear error at boot,
 * not a cryptic 'Cannot read property of undefined' at 3 AM in production.
 */
const { z } = require('zod');
require('dotenv').config();

const envSchema = z.object({
  NODE_ENV:           z.enum(['development', 'test', 'production']).default('development'),
  PORT:               z.coerce.number().default(3000),

  // MongoDB
  MONGO_URI:          z.string().min(1, 'MONGO_URI is required'),

  // Redis
  REDIS_URL:          z.string().min(1, 'REDIS_URL is required'),

  // JWT
  JWT_ACCESS_SECRET:  z.string().min(32, 'JWT_ACCESS_SECRET must be ≥32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be ≥32 chars'),
  JWT_ACCESS_TTL:     z.string().default('15m'),
  JWT_REFRESH_TTL:    z.string().default('7d'),

  // QR
  QR_TOKEN_TTL_SECS:  z.coerce.number().default(45),
  QR_LOCATION_RADIUS: z.coerce.number().default(100),   // metres

  // AI service
  AI_SERVICE_URL:     z.string().url().default('http://ai-service:8000'),

  // Email (SendGrid-compatible SMTP)
  SMTP_HOST:          z.string().optional(),
  SMTP_PORT:          z.coerce.number().default(587),
  SMTP_USER:          z.string().optional(),
  SMTP_PASS:          z.string().optional(),
  FROM_EMAIL:         z.string().email().default('no-reply@attendance.app'),

  // Twilio (SMS)
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN:  z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  // AWS S3
  AWS_REGION:         z.string().default('us-east-1'),
  AWS_BUCKET_NAME:    z.string().optional(),

  // Attendance policy
  MIN_ATTENDANCE_PCT: z.coerce.number().default(75),
  BCRYPT_ROUNDS:      z.coerce.number().default(12),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Invalid environment variables:\n', parsed.error.format());
  process.exit(1);
}

module.exports = parsed.data;
