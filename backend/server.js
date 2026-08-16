/**
 * server.js — Application entry point
 *
 * Bootstrap order:
 *   1. Validate environment (env.js — crashes fast if misconfigured)
 *   2. Connect MongoDB
 *   3. Connect Redis (×3 clients)
 *   4. Create HTTP server from Express app
 *   5. Attach Socket.io WebSocket server
 *   6. Start listening
 *   7. Register cron jobs
 *
 * Graceful shutdown on SIGTERM/SIGINT ensures:
 *   - No new connections accepted
 *   - Existing connections finish
 *   - DB connections closed cleanly
 *   This is critical in Kubernetes/ECS where rolling deploys send SIGTERM.
 */
const http = require('http');

require('./src/config/env');  // validate env first — crash early if broken

const app = require('./src/app');
const { connectDB, disconnectDB }    = require('./src/config/db');
const { connectRedis }               = require('./src/config/redis');
const { initializeWebSocket }        = require('./src/modules/notifications/websocket.service');
const { startAnalyticsJob }          = require('./src/jobs/analyticsJob');
const logger                         = require('./src/utils/logger');
const env                            = require('./src/config/env');

const server = http.createServer(app);

// Attach WebSocket server before listening
initializeWebSocket(server);

async function bootstrap() {
  logger.info(`Starting attendance-api [${env.NODE_ENV}]…`);

  await connectDB();
  await connectRedis();

  server.listen(env.PORT, () => {
    logger.info(`✅ Server running on http://0.0.0.0:${env.PORT}`);
  });

  if (env.NODE_ENV !== 'test') {
    startAnalyticsJob();
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function gracefulShutdown(signal) {
  logger.info(`${signal} received. Shutting down gracefully…`);

  server.close(async () => {
    logger.info('HTTP server closed');
    await disconnectDB();
    logger.info('All connections closed. Exiting.');
    process.exit(0);
  });

  // Force exit after 30s if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 30_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection:', reason);
  gracefulShutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

bootstrap();
