/**
 * logger.js — Structured logging with Winston
 *
 * In production: JSON output → CloudWatch / Datadog can parse it.
 * In development: Colourised human-readable format.
 *
 * Every log includes timestamp, level, and service name.
 * In a microservice setup this 'service' tag is how you filter in aggregators.
 */
const winston = require('winston');

const { combine, timestamp, printf, colorize, json, errors } = winston.format;
const env = require('../config/env');

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} [${level}]: ${stack || message}`;
  })
);

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  defaultMeta: { service: 'attendance-api' },
  format: env.NODE_ENV === 'production' ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console(),
    ...(env.NODE_ENV === 'production'
      ? [new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
         new winston.transports.File({ filename: 'logs/combined.log' })]
      : []),
  ],
});

module.exports = logger;
