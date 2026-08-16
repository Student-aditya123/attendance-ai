/**
 * errorHandler.js — Centralised error handling middleware
 *
 * Must be registered LAST in Express (after all routes).
 * Normalises all error types into a consistent JSON shape.
 *
 * Error types handled:
 *   CastError       — Invalid MongoDB ObjectId in URL param
 *   ValidationError — Mongoose schema validation failure
 *   11000 code      — MongoDB duplicate key (e.g. duplicate email)
 *   JsonWebToken    — Auth errors
 *   Generic         — Everything else (stack in dev, clean message in prod)
 */
const logger = require('../utils/logger');
const env    = require('../config/env');

function errorHandler(err, req, res, next) {
  let error = {
    success:    false,
    message:    err.message || 'Internal Server Error',
    statusCode: err.statusCode || 500,
  };

  // Invalid MongoDB ObjectId (e.g. /users/not-an-id)
  if (err.name === 'CastError') {
    error.message    = `Invalid ${err.path}: ${err.value}`;
    error.statusCode = 400;
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    error.message    = messages.join('. ');
    error.statusCode = 422;
  }

  // MongoDB duplicate key
  if (err.code === 11000) {
    const field      = Object.keys(err.keyValue || {})[0];
    error.message    = `Duplicate value for field: ${field}`;
    error.statusCode = 409;
  }

  // JWT errors (shouldn't normally reach here — caught in auth middleware)
  if (err.name === 'JsonWebTokenError') {
    error.message    = 'Invalid token';
    error.statusCode = 401;
  }
  if (err.name === 'TokenExpiredError') {
    error.message    = 'Token expired';
    error.statusCode = 401;
  }

  // Log server errors (not client errors)
  if (error.statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} — ${error.statusCode}`, {
      message: err.message,
      stack:   err.stack,
      userId:  req.user?._id,
    });
  }

  const response = {
    success: false,
    message: error.message,
    ...(env.NODE_ENV === 'development' && { stack: err.stack }),
  };

  return res.status(error.statusCode).json(response);
}

/** Wrap async route handlers to forward errors to the global handler */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Create a custom AppError with a status code */
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { errorHandler, asyncHandler, AppError };
