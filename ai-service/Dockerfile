# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Builder — compile dlib (C++ library face_recognition depends on)
#
# Why a separate build stage?
#   dlib requires CMake, a C++ compiler, and Boost libraries to compile.
#   That's ~1.5 GB of build tools. The final image only needs the compiled .so
#   file — not the compilers. Multi-stage build keeps the runtime image lean.
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

# Install build dependencies (only needed in the builder stage)
RUN apt-get update && apt-get install -y --no-install-recommends \
        cmake \
        g++ \
        build-essential \
        libopenblas-dev \
        liblapack-dev \
        libx11-dev \
        libgtk-3-dev \
        libboost-python-dev \
        libboost-thread-dev \
        git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Upgrade pip and install wheel
RUN pip install --upgrade pip wheel

# Install dlib first (requires the C++ toolchain)
# Pin version to avoid surprise breaks from upstream changes
RUN pip install --no-cache-dir dlib==19.24.4

# Copy and install all other Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Runtime — minimal image, no build tools
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

# Runtime system libs for face_recognition (OpenCV headless + dlib)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libopenblas-base \
        libgomp1 \
        libglib2.0-0 \
        libsm6 \
        libxext6 \
    && rm -rf /var/lib/apt/lists/*

# Security: run as non-root
RUN addgroup --system aigroup && adduser --system --ingroup aigroup aiuser

WORKDIR /app

# Copy installed packages from builder (no pip in runtime stage)
COPY --from=builder /install /usr/local

# Copy application source
COPY --chown=aiuser:aigroup . .

# Create directories for model file and training data
RUN mkdir -p /app/models /app/data && chown -R aiuser:aigroup /app/models /app/data

# Switch to non-root
USER aiuser

# ── Train the risk model at build time (uses synthetic data) ─────────────────
# This bakes a working model into the image so the service starts fully functional.
# In production, mount a volume with a model trained on real data instead.
RUN python training/generate_sample_data.py \
        --samples 15000 \
        --out /app/data/training.csv \
    && python training/train_risk_model.py \
        --data /app/data/training.csv \
        --model-out /app/models/risk_model.joblib \
        --eval \
    && rm -rf /app/data   # remove training data from final image

EXPOSE 8000

# Health check — used by Docker Compose and ECS
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" \
    || exit 1

CMD ["python", "-m", "uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--log-level", "info"]
