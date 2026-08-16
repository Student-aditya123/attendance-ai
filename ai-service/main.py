"""
main.py — FastAPI AI Microservice Entry Point

Called by: Node.js attendance service (via axios, internal Docker network)
Never exposed directly to the frontend.

Startup sequence:
  1. Validate environment (config.py — crashes fast if misconfigured)
  2. Load risk model into memory (warm it up on first request otherwise)
  3. Register routes
  4. Start uvicorn
"""
import logging
import time
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import get_settings
from models.risk_model import load_model
from routers import face, predict

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger   = logging.getLogger(__name__)
settings = get_settings()


# ── Lifespan (startup / shutdown) ─────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── STARTUP ──────────────────────────────────────────────────────────────
    logger.info(f"Starting AI service [{settings.APP_ENV}]")

    # Pre-load the risk model so the first prediction request isn't slow
    model = load_model()
    if model:
        logger.info("Risk model pre-loaded ✓")
    else:
        logger.warning(
            "Risk model not found — rule-based fallback will be used. "
            "Run: python training/train_risk_model.py --data data/training.csv --eval"
        )

    logger.info("AI service ready ✓")
    yield

    # ── SHUTDOWN ─────────────────────────────────────────────────────────────
    logger.info("AI service shutting down")


# ── App factory ───────────────────────────────────────────────────────────────
def create_app() -> FastAPI:
    app = FastAPI(
        title       = "Attendance AI Service",
        description = (
            "Internal microservice handling face recognition (enrollment + identification) "
            "and ML-based attendance risk prediction. "
            "Not exposed to the public internet — internal Docker network only."
        ),
        version     = "1.0.0",
        lifespan    = lifespan,
        docs_url    = "/docs" if settings.APP_ENV != "production" else None,
        redoc_url   = "/redoc" if settings.APP_ENV != "production" else None,
    )

    # ── CORS (only allows requests from the Node backend) ────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins  = ["http://backend:3000", "http://localhost:3000"],
        allow_methods  = ["GET", "POST", "DELETE"],
        allow_headers  = ["Content-Type", "X-Internal-Token"],
    )

    # ── Request timing middleware ──────────────────────────────────────────────
    @app.middleware("http")
    async def add_timing_header(request: Request, call_next):
        t_start  = time.perf_counter()
        response = await call_next(request)
        elapsed  = round((time.perf_counter() - t_start) * 1000, 2)
        response.headers["X-Process-Time-Ms"] = str(elapsed)
        return response

    # ── Global exception handler ──────────────────────────────────────────────
    @app.exception_handler(Exception)
    async def global_error(request: Request, exc: Exception):
        logger.exception(f"Unhandled error on {request.method} {request.url.path}: {exc}")
        return JSONResponse(
            status_code=500,
            content={"success": False, "detail": "Internal AI service error"},
        )

    # ── Routers ───────────────────────────────────────────────────────────────
    app.include_router(face.router)
    app.include_router(predict.router)

    # ── Health check ─────────────────────────────────────────────────────────
    @app.get("/health", tags=["Meta"])
    async def health():
        model_loaded = load_model() is not None
        return {
            "status":       "ok",
            "service":      "attendance-ai",
            "version":      "1.0.0",
            "model_loaded": model_loaded,
            "model_mode":   "ml" if model_loaded else "rule-based",
        }

    # ── API root (useful for inter-service ping checks) ────────────────────
    @app.get("/", tags=["Meta"])
    async def root():
        return {
            "service": "Attendance AI Service",
            "docs":    "/docs",
            "health":  "/health",
        }

    return app


# ── Entry point ───────────────────────────────────────────────────────────────
app = create_app()

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host        = "0.0.0.0",
        port        = settings.PORT,
        log_level   = settings.LOG_LEVEL,
        reload      = settings.APP_ENV == "development",
        workers     = 1,   # face_recognition is not thread-safe — use 1 worker + async
    )
