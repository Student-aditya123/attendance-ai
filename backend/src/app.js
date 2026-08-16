const express       = require('express');
const helmet        = require('helmet');
const compression   = require('compression');
const cors          = require('cors');
const morgan        = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const cookieParser  = require('cookie-parser');

const { general }  = require('./middleware/rateLimit');
const { errorHandler } = require('./middleware/errorHandler');
const logger       = require('./utils/logger');
const env          = require('./config/env');

const app = express();
app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(compression());

const origins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',');
app.use(cors({ origin: (o, cb) => (!o || origins.includes(o)) ? cb(null,true) : cb(new Error('CORS')), credentials:true, methods:['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders:['Content-Type','Authorization','X-Device-Fingerprint'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(mongoSanitize());
if (env.NODE_ENV !== 'test') app.use(morgan(':method :url :status :response-time ms', { stream: { write: m => logger.http(m.trim()) } }));
app.use('/api', general);
app.get('/health', (_, res) => res.json({ status:'ok', service:'attendance-api', ts: new Date().toISOString() }));

app.use('/api/auth',          require('./modules/auth/auth.routes'));
app.use('/api/attendance',    require('./modules/attendance/attendance.routes'));
app.use('/api/analytics',     require('./modules/analytics/analytics.routes'));
app.use('/api/classes',       require('./modules/classes/class.routes'));
app.use('/api/users',         require('./modules/users/user.routes'));
app.use('/api/notifications', require('./modules/notifications/notification.routes'));

app.use((req, res) => res.status(404).json({ success:false, message:`Not found: ${req.method} ${req.originalUrl}` }));
app.use(errorHandler);
module.exports = app;
