# AttendanceAI — Automated Student Attendance Monitoring System

> Production-grade attendance platform for colleges: multi-mode marking (QR + Face Recognition), 
> real-time dashboards, ML-based risk prediction, and fraud detection.

[![CI](https://github.com/your-org/attendance-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/attendance-ai/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/your-org/attendance-ai/badge.svg)](https://codecov.io/gh/your-org/attendance-ai)

---

## Architecture

```
Students/Faculty/Admin (Browser / Mobile)
            │
            ▼
    ┌─────────────┐
    │    Nginx     │  SSL termination · Rate limiting · Static SPA
    └──────┬──────┘
           │
    ┌──────┴──────────────────────────────────┐
    │              Internal Network            │
    │                                          │
    │  ┌─────────────┐    ┌─────────────────┐ │
    │  │  Node.js API │    │  FastAPI AI Svc │ │
    │  │  (Express)   │───▶│  (face + risk)  │ │
    │  └──────┬───────┘    └─────────────────┘ │
    │         │                                 │
    │  ┌──────┴───────────────────┐             │
    │  │  MongoDB Atlas  │ Redis  │             │
    │  └──────────────────────────┘             │
    └──────────────────────────────────────────┘
              │               │
           AWS S3         CloudWatch
        (face encodings)    (logs)
```

## Quick Start (Docker)

```bash
# 1. Clone and configure
git clone https://github.com/your-org/attendance-ai
cd attendance-ai
cp backend/.env.example  backend/.env
cp ai-service/.env.example ai-service/.env

# 2. Start everything
make dev-d

# 3. Seed demo data
make seed

# 4. Open app
make open
```

**Demo credentials** (all passwords: `Password@123`):

| Role    | Email                        |
|---------|------------------------------|
| Admin   | admin@university.edu         |
| Faculty | faculty1@university.edu      |
| Student | cs21001@university.edu       |

---

## Project Structure

```
attendance-ai/
├── backend/               Node.js + Express API
│   ├── src/
│   │   ├── modules/       Feature modules (auth, attendance, analytics)
│   │   ├── models/        Mongoose schemas
│   │   ├── middleware/     JWT auth, rate limiting, validation
│   │   ├── utils/          Logger, JWT helpers, geo utils
│   │   └── jobs/          Nightly analytics cron
│   └── tests/
│
├── ai-service/            Python + FastAPI AI microservice
│   ├── models/            Face encoder + Risk prediction model
│   ├── routers/           API routes (face, predict)
│   ├── training/          Data generation + model training scripts
│   └── tests/
│
├── frontend/              React 18 + Tailwind SPA
│   └── src/
│       ├── pages/         Admin, Faculty, Student dashboards + Scanner
│       ├── components/    Reusable UI components
│       ├── hooks/         useAuth, useWebSocket, useOfflineSync
│       └── services/      API client, offline IndexedDB
│
├── nginx/                 Production Nginx config
├── infra/ecs/             AWS ECS task definitions
├── scripts/               seed.js, deploy.sh
├── .github/workflows/     CI + CD pipelines
├── docker-compose.yml     Local development
├── docker-compose.prod.yml Production
└── Makefile               All commands
```

---

## Tech Stack

| Layer       | Technology                                    |
|-------------|-----------------------------------------------|
| Frontend    | React 18, Tailwind CSS, Recharts, Socket.io   |
| Backend     | Node.js 20, Express, JWT, Socket.io, Redis    |
| AI Service  | Python 3.11, FastAPI, face_recognition, sklearn|
| Database    | MongoDB Atlas (M10+), Redis (ElastiCache)     |
| Storage     | AWS S3 (face encodings, exports)              |
| Hosting     | AWS ECS Fargate, CloudFront CDN               |
| CI/CD       | GitHub Actions + OIDC (no long-lived keys)    |
| Monitoring  | CloudWatch Logs + Alarms                      |

---

## API Reference

### Authentication

| Method | Endpoint                   | Auth  | Description              |
|--------|----------------------------|-------|--------------------------|
| POST   | `/api/auth/register`       | —     | Register new user        |
| POST   | `/api/auth/login`          | —     | Login, returns JWT pair  |
| POST   | `/api/auth/refresh`        | —     | Rotate refresh token     |
| POST   | `/api/auth/logout`         | —     | Revoke refresh token     |
| GET    | `/api/auth/me`             | ✓     | Get current user profile |
| PUT    | `/api/auth/change-password`| ✓     | Change password          |

### Attendance

| Method | Endpoint                                  | Role          | Description                  |
|--------|-------------------------------------------|---------------|------------------------------|
| POST   | `/api/attendance/sessions`                | Faculty/Admin | Start QR session             |
| POST   | `/api/attendance/sessions/:id/rotate`     | Faculty/Admin | Rotate QR token              |
| DELETE | `/api/attendance/sessions/:id`            | Faculty/Admin | End session                  |
| GET    | `/api/attendance/sessions/:id`            | Faculty/Admin | Get session attendance list  |
| PUT    | `/api/attendance/sessions/:id/manual`     | Faculty/Admin | Manual override              |
| POST   | `/api/attendance/mark/qr`                 | Student       | Mark via QR scan             |
| POST   | `/api/attendance/mark/face`               | Student       | Mark via face recognition    |
| GET    | `/api/attendance/students/:id/summary`    | Self/Admin    | Personal attendance summary  |

### Analytics

| Method | Endpoint                        | Role          | Description            |
|--------|---------------------------------|---------------|------------------------|
| GET    | `/api/analytics/admin/overview` | Admin         | System-wide overview   |
| GET    | `/api/analytics/admin/at-risk`  | Admin         | At-risk student list   |
| GET    | `/api/analytics/leaderboard`    | All           | Top students           |
| GET    | `/api/analytics/heatmap/:id`    | Faculty/Admin | Attendance heatmap     |
| GET    | `/api/analytics/export/:id`     | Faculty/Admin | CSV/JSON export        |

### AI Service

| Method | Endpoint             | Description                          |
|--------|----------------------|--------------------------------------|
| POST   | `/face/enroll`       | Register student face (1–5 photos)   |
| POST   | `/face/recognize`    | Match face → confidence score        |
| GET    | `/face/status/:id`   | Check if student has face enrolled   |
| DELETE | `/face/enroll/:id`   | GDPR: delete face encoding           |
| POST   | `/predict/risk`      | Predict dropout risk (single)        |
| POST   | `/predict/batch`     | Batch risk prediction (≤5000)        |
| GET    | `/predict/model/info`| Model metadata + feature importances |

---

## Anti-Fraud System

QR attendance uses 5 independent validation layers:

```
Scan QR
  │
  ├─ 1. Token not expired (JWT exp claim)
  ├─ 2. Nonce not blacklisted in Redis (replay prevention)
  ├─ 3. GPS within 100m of classroom (location)
  ├─ 4. Device fingerprint matches enrolled device
  └─ 5. Student not already marked in this session
         │
         └─ ALL PASS → Record attendance + WebSocket broadcast
         └─ ANY FAIL → Log fraud attempt + Alert admin dashboard
```

Face recognition adds:
- Minimum **80% confidence** threshold (configurable)
- Liveness hint via frame-to-frame consistency (Phase 05 extension)

---

## Deployment

### Prerequisites

```bash
# Required secrets in GitHub Actions:
AWS_ACCOUNT_ID          # 12-digit AWS account ID
CLOUDFRONT_DIST_ID      # CloudFront distribution for frontend
FRONTEND_S3_BUCKET      # S3 bucket name for React build
SLACK_BOT_TOKEN         # For deployment notifications
SLACK_CHANNEL_ID        # Slack channel for notifications
CODECOV_TOKEN           # Code coverage reporting

# Required SSM Parameter Store values:
/attendance/prod/MONGO_URI
/attendance/prod/REDIS_URL
/attendance/prod/JWT_ACCESS_SECRET
/attendance/prod/JWT_REFRESH_SECRET
/attendance/prod/SMTP_HOST
/attendance/prod/SMTP_USER
/attendance/prod/SMTP_PASS
/attendance/prod/AWS_BUCKET_NAME
```

### First Deployment

```bash
# 1. Create ECR repositories
aws ecr create-repository --repository-name attendance-backend
aws ecr create-repository --repository-name attendance-ai

# 2. Create ECS cluster
aws ecs create-cluster --cluster-name attendance-cluster

# 3. Create SSM parameters
aws ssm put-parameter --name /attendance/prod/MONGO_URI \
  --value "mongodb+srv://..." --type SecureString

# 4. Push initial images
make build
ECR_REGISTRY=... IMAGE_TAG=initial make push-ecr

# 5. Deploy with Compose (or push to main to trigger CD)
make prod
```

### Ongoing Deployments

Push to `main` — GitHub Actions handles everything:
1. Tests (Node + Python, parallel)
2. Security scan (npm audit + bandit + Trivy)
3. Docker build with layer caching
4. ECR push
5. ECS rolling update (zero downtime)
6. Frontend S3 sync + CloudFront invalidation
7. Smoke tests
8. Slack notification

---

## Environment Variables

See `backend/.env.example` and `ai-service/.env.example` for full lists.

Key variables:

| Variable                  | Default | Description                         |
|---------------------------|---------|-------------------------------------|
| `QR_TOKEN_TTL_SECS`       | 45      | How long each QR token is valid     |
| `QR_LOCATION_RADIUS`      | 100     | GPS radius in metres for validation |
| `FACE_DISTANCE_THRESHOLD` | 0.50    | Max face distance (lower = stricter)|
| `FACE_MIN_CONFIDENCE`     | 0.80    | Min confidence to mark attendance   |
| `MIN_ATTENDANCE_PCT`      | 75      | Below this → at-risk alerts fire    |
| `BCRYPT_ROUNDS`           | 12      | Password hashing cost               |

---

## Re-training the Risk Model

The model ships pre-trained on synthetic data. Re-train monthly on real data:

```bash
# 1. Export attendance records from MongoDB
python ai-service/training/export_real_data.py \
  --uri $MONGO_URI \
  --out ai-service/data/real_training.csv

# 2. Train and evaluate
make train-model-real

# 3. The new model.joblib is loaded on next service restart
```

Model performance on synthetic data: **100% AUC** (clean data).
Expected real-world performance: **~87% AUC** (overlapping attendance patterns).

---

## License

MIT — see [LICENSE](LICENSE)
