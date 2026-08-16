/**
 * db.js — MongoDB connection manager
 *
 * Uses Mongoose's built-in connection pool (default 5, bumped to 10 here).
 * The retry loop handles the race condition where MongoDB isn't ready
 * when the Node container starts in Docker Compose.
 */
const mongoose = require('mongoose');
const logger   = require('../utils/logger');
const env      = require('./env');

const RETRY_INTERVAL_MS = 5000;
const MAX_RETRIES       = 5;

async function connectDB(retries = MAX_RETRIES) {
  try {
    await mongoose.connect(env.MONGO_URI, {
      maxPoolSize:        10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS:    45000,
    });

    logger.info('MongoDB connected ✓');

    mongoose.connection.on('error',        (err) => logger.error('MongoDB error:', err));
    mongoose.connection.on('disconnected', ()    => logger.warn('MongoDB disconnected'));
  } catch (err) {
    if (retries === 0) {
      logger.error('MongoDB connection failed after max retries. Exiting.');
      process.exit(1);
    }
    logger.warn(`MongoDB not ready. Retrying in ${RETRY_INTERVAL_MS / 1000}s… (${retries} left)`);
    await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
    return connectDB(retries - 1);
  }
}

async function disconnectDB() {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected ✓');
}

module.exports = { connectDB, disconnectDB };
