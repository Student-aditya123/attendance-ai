# ─── Stage 1: Build / dependency install ──────────────────────────────────────
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files first (layer caching — npm install only reruns when these change)
COPY package.json package-lock.json ./

# Install ONLY production dependencies for the final image
# devDependencies (jest, nodemon) are excluded
RUN npm ci --only=production && npm cache clean --force

# ─── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Security: run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy installed node_modules from builder (no npm install in runtime stage)
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY --chown=appuser:appgroup . .

# Remove dev artifacts
RUN rm -rf tests .env.* *.test.js

# Switch to non-root user
USER appuser

# Expose API port
EXPOSE 3000

# Health check for Docker / ECS
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Start the server
CMD ["node", "server.js"]
