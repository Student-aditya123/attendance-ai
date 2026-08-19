const express       = require('express');
const helmet        = require('helmet');
const compression   = require('compression');
const cors          = require('cors');
const morgan        = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const cookieParser  = require('cookie-parser');

const { general }      = require('./middleware/rateLimit');
const { errorHandler } = require('./middleware/errorHandler');
const logger           = require('./utils/logger');
const env              = require('./config/env');

const app = express();

app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(compression());

// Cleanly parse allowed origins from environment variable
const envOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Fallback origins for common local development ports
const defaultOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  env.CLIENT_URL,
].filter(Boolean);

const allowedOrigins = Array.from(new Set([...envOrigins, ...defaultOrigins]));

const corsOptions = {
  origin: (origin, callback) => {
    // 1. Allow requests with no origin (e.g., Postman, mobile apps, cURL, server-to-server)
    if (!origin) {
      return callback(null, true);
    }

    // 2. Allow all origins during local development
    if (env.NODE_ENV === 'development') {
      return callback(null, true);
    }

    // 3. Allow whitelisted origins
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // 4. Reject unallowed origins gracefully (null, false) without throwing Express stack traces
    logger.warn(`CORS blocked request from origin: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Device-Fingerprint',
    'X-Requested-With',
  ],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(mongoSanitize());

if (env.NODE_ENV !== 'test') {
  app.use(
    morgan(':method :url :status :response-time ms', {
      stream: { write: (m) => logger.http(m.trim()) },
    })
  );
}

app.use('/api', general);
app.get('/health', (_, res) =>
  res.json({
    status: 'ok',
    service: 'attendance-api',
    ts: new Date().toISOString(),
  })
);

app.use('/api/auth',          require('./modules/auth/auth.routes'));
app.use('/api/attendance',    require('./modules/attendance/attendance.routes'));
app.use('/api/analytics',     require('./modules/analytics/analytics.routes'));
app.use('/api/classes',       require('./modules/classes/class.routes'));
app.use('/api/users',         require('./modules/users/user.routes'));
app.use('/api/notifications', require('./modules/notifications/notification.routes'));

app.use((req, res) =>
  res
    .status(404)
    .json({ success: false, message: `Not found: ${req.method} ${req.originalUrl}` })
);

app.use(errorHandler);

module.exports = app;