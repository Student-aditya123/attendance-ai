# AttendanceAI — Complete Local Setup Guide

> **Time to get running:** ~20 minutes (first time, dlib compiles slowly)  
> **Tested on:** macOS 14, Ubuntu 22.04, Windows 11 (WSL2)

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Project Structure](#2-project-structure)
3. [Clone / Copy the Project](#3-clone--copy-the-project)
4. [Install VS Code Extensions](#4-install-vs-code-extensions)
5. [Start MongoDB and Redis](#5-start-mongodb-and-redis)
6. [Configure Environment Variables](#6-configure-environment-variables)
7. [Install Dependencies](#7-install-dependencies)
8. [Train the AI Model](#8-train-the-ai-model)
9. [Start All Services](#9-start-all-services)
10. [Seed the Database](#10-seed-the-database)
11. [Open the App](#11-open-the-app)
12. [Running Services Individually](#12-running-services-individually)
13. [Docker Compose (Alternative)](#13-docker-compose-alternative)
14. [VS Code Shortcuts](#14-vs-code-shortcuts)
15. [Common Errors & Fixes](#15-common-errors--fixes)
16. [API Testing in VS Code](#16-api-testing-in-vs-code)
17. [Debugging in VS Code](#17-debugging-in-vs-code)

---

## 1. Prerequisites

Install all of these **before** anything else.

### Node.js 20+
```bash
# Check current version
node --version   # Must show v20.x.x or higher

# If not installed — download from:
# https://nodejs.org/en/download  (LTS version)

# Or use nvm (recommended):
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20
nvm use 20
```

### Python 3.11+
```bash
# Check current version
python3 --version   # Must show Python 3.11.x or 3.12.x

# macOS — install via Homebrew:
brew install python@3.11

# Ubuntu/Debian:
sudo apt update && sudo apt install python3.11 python3.11-pip python3.11-venv

# Windows — download from:
# https://python.org/downloads  (check "Add to PATH" during install)
```

### MongoDB 7.0
```bash
# macOS:
brew tap mongodb/brew && brew install mongodb-community@7.0
brew services start mongodb-community@7.0

# Ubuntu:
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update && sudo apt install -y mongodb-org
sudo systemctl start mongod && sudo systemctl enable mongod

# Windows — download installer from:
# https://www.mongodb.com/try/download/community
# Add C:\Program Files\MongoDB\Server\7.0\bin to PATH

# Verify MongoDB is running:
mongosh --eval "db.adminCommand('ping')"
# Should print: { ok: 1 }
```

### Redis 7
```bash
# macOS:
brew install redis
brew services start redis

# Ubuntu:
sudo apt install redis-server
sudo systemctl start redis && sudo systemctl enable redis

# Windows — use WSL2 (recommended) or:
# Download Redis for Windows: https://github.com/tporadowski/redis/releases

# Verify Redis is running:
redis-cli ping
# Should print: PONG
```

### Build tools for dlib (face recognition)
```bash
# macOS:
xcode-select --install        # installs clang, cmake automatically
brew install cmake openblas

# Ubuntu/Debian:
sudo apt install -y build-essential cmake g++ libopenblas-dev liblapack-dev \
  libx11-dev libgtk-3-dev libboost-python-dev libboost-thread-dev

# Windows (WSL2 — recommended):
sudo apt install -y build-essential cmake g++ libopenblas-dev liblapack-dev
# Native Windows: install Visual Studio Build Tools + cmake from cmake.org
```

### VS Code
Download from https://code.visualstudio.com  
Open the project folder: `File → Open Folder → attendance-ai/`

---

## 2. Project Structure

After setup, your project looks like this:
```
attendance-ai/
├── backend/              ← Node.js Express API  (port 3000)
│   ├── src/
│   │   ├── modules/      ← auth, attendance, analytics, classes, users
│   │   ├── models/       ← Mongoose schemas
│   │   ├── middleware/   ← JWT, rate limiting, validation
│   │   └── config/       ← db, redis, env
│   ├── .env              ← your local config (you create this)
│   └── server.js
│
├── frontend/             ← React 18 + Vite  (port 5173)
│   ├── src/
│   │   ├── pages/        ← Login, Admin, Faculty, Student, Analytics, Scanner
│   │   ├── hooks/        ← useAuth, useWebSocket, useOfflineSync
│   │   ├── services/     ← Axios API client
│   │   └── store/        ← Redux Toolkit auth slice
│   └── vite.config.js
│
├── ai-service/           ← Python FastAPI  (port 8000)
│   ├── models/           ← face_encoder.py, risk_model.py
│   ├── routers/          ← face.py, predict.py
│   ├── training/         ← generate_sample_data.py, train_risk_model.py
│   └── main.py
│
├── .vscode/              ← Tasks, debug configs, extensions, settings
├── scripts/              ← setup.js, seed.js, health-check.js
├── docker-compose.yml    ← Full stack via Docker
├── api-tests.http        ← REST Client test file
└── package.json          ← Root workspace scripts
```

---

## 3. Clone / Copy the Project

```bash
# If you have the project as a zip — extract it and open VS Code:
code attendance-ai/

# If cloning from Git:
git clone https://github.com/your-org/attendance-ai.git
cd attendance-ai
code .
```

---

## 4. Install VS Code Extensions

**Option A — Automatic (recommended):**  
VS Code will show a popup: *"This workspace has extension recommendations. Install them?"*  
Click **Install All**.

**Option B — Manual:**  
Press `Ctrl+Shift+X` (Extensions panel) → search and install:

| Extension | Publisher | Why |
|-----------|-----------|-----|
| ESLint | dbaeumer | JS lint errors inline |
| Prettier | esbenp | Auto-format on save |
| Python | ms-python | Python language support |
| Debugpy | ms-python | Python debugging |
| Black Formatter | ms-python | Python auto-format |
| Docker | ms-azuretools | Docker file support |
| MongoDB for VS Code | mongodb | Browse DB in sidebar |
| REST Client | humao | Test API from `.http` files |
| Tailwind CSS IntelliSense | bradlc | Tailwind autocomplete |
| GitLens | eamodio | Git blame + history |
| Playwright Test | ms-playwright | E2E test runner in UI |
| Material Icon Theme | PKief | Better file icons |

---

## 5. Start MongoDB and Redis

> **Skip this section if using Docker Compose** (Section 13)

Open two VS Code terminals (`Ctrl+`` ` → New Terminal`):

**Terminal 1 — MongoDB:**
```bash
# macOS / Linux:
mongod --dbpath ~/data/db

# If ~/data/db doesn't exist:
mkdir -p ~/data/db && mongod --dbpath ~/data/db

# Windows:
mongod --dbpath C:\data\db

# Verify — in a new terminal:
mongosh attendance_db --eval "db.stats()"
```

**Terminal 2 — Redis:**
```bash
# macOS / Linux:
redis-server

# Windows:
redis-server.exe

# Verify — in a new terminal:
redis-cli ping   # → PONG
```

> **Tip:** Use VS Code Tasks instead — press `Ctrl+Shift+P` → `Tasks: Run Task`  
> → `🍃 Start MongoDB` and `🔴 Start Redis`

---

## 6. Configure Environment Variables

This is the most important step. Wrong env vars = nothing works.

**Step 6a — Backend:**
```bash
cd backend
cp .env.example .env
```

Open `backend/.env` in VS Code and set these values:

```env
# ── Required (change these) ─────────────────────────────────────────────────
NODE_ENV=development
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/attendance_db
REDIS_URL=redis://127.0.0.1:6379

# Generate secrets — run in terminal:
# node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_ACCESS_SECRET=PASTE_64_CHAR_RANDOM_HEX_HERE
JWT_REFRESH_SECRET=PASTE_DIFFERENT_64_CHAR_RANDOM_HEX_HERE

JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

# ── QR Settings (keep as-is for local dev) ──────────────────────────────────
QR_TOKEN_TTL_SECS=45
QR_LOCATION_RADIUS=100
MIN_ATTENDANCE_PCT=75
BCRYPT_ROUNDS=10

# ── AI Service URL ───────────────────────────────────────────────────────────
AI_SERVICE_URL=http://localhost:8000

# ── Frontend URL (for CORS) ──────────────────────────────────────────────────
FRONTEND_URL=http://localhost:5173
ALLOWED_ORIGINS=http://localhost:5173

# ── Email (optional for local dev — alerts won't send but app still works) ──
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=your@gmail.com
# SMTP_PASS=your-app-password
FROM_EMAIL=noreply@attendance.local

# ── AWS S3 (optional — face recognition won't persist encodings locally) ────
AWS_REGION=us-east-1
AWS_BUCKET_NAME=attendance-local-dev
```

**Step 6b — AI Service:**
```bash
cd ai-service
cp .env.example .env
```

Open `ai-service/.env` and set:
```env
APP_ENV=development
PORT=8000
MONGO_URI=mongodb://127.0.0.1:27017/attendance_db
AWS_REGION=us-east-1
AWS_BUCKET_NAME=attendance-local-dev
FACE_DISTANCE_THRESHOLD=0.50
FACE_MIN_CONFIDENCE=0.80
RISK_MODEL_PATH=models/risk_model.joblib
MIN_ATTENDANCE_PCT=75.0
```

> **Note on AWS S3:** For local dev without S3, face enrollment saves encodings in-memory only.  
> Risk prediction and QR attendance work fully without AWS credentials.

---

## 7. Install Dependencies

**Option A — One command from project root:**
```bash
# In the attendance-ai/ root directory:
node scripts/setup.js
```
This installs Node.js deps for backend + frontend AND Python deps for ai-service.

**Option B — Manual (if setup.js fails):**

Open three VS Code terminals:

**Terminal 1 — Backend:**
```bash
cd backend
npm install
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm install
```

**Terminal 3 — AI Service:**
```bash
cd ai-service

# Create a virtual environment (strongly recommended):
python3 -m venv .venv

# Activate it:
# macOS/Linux:
source .venv/bin/activate
# Windows:
.venv\Scripts\activate

# Install dependencies:
pip install -r requirements.txt

# ⚠ dlib takes 5–10 minutes to compile from source — this is normal
```

---

## 8. Train the AI Model

The risk prediction model must be trained before starting the AI service.

```bash
# From the project root:
npm run train:model

# Or manually:
cd ai-service

# Step 1: Generate synthetic training data (takes ~5 seconds)
python3 training/generate_sample_data.py \
  --samples 15000 \
  --out data/training.csv

# Step 2: Train the model (takes ~10 seconds)
python3 training/train_risk_model.py \
  --data data/training.csv \
  --model-out models/risk_model.joblib \
  --eval
```

You should see output like:
```
🚀 Training risk model from data/training.csv
  Fitting pipeline...
  AUC-ROC: 1.0000
✅ Model saved → models/risk_model.joblib  (3 KB)
```

---

## 9. Start All Services

### Recommended: Single command (concurrently)
```bash
# From the attendance-ai/ root directory:
npm install   # installs concurrently (root dev dep)
npm run dev
```

This starts all three services in one terminal with colour-coded output:
- 🔵 **BACKEND** — Node.js Express API on :3000
- 🟢 **AI** — FastAPI AI service on :8000  
- 🟣 **FRONTEND** — Vite React on :5173

### Or use VS Code Tasks (easiest):
1. Press `Ctrl+Shift+P`
2. Type `Tasks: Run Task`
3. Select `🚀 Start All Services`

---

## 10. Seed the Database

After services are running, populate the database with demo data:

```bash
# From project root:
npm run seed
```

This creates:
- **1 Admin** — admin@university.edu
- **3 Faculty** — faculty1/2/3@university.edu
- **20 Students** — cs21001–cs21010, ece21001–ece21005, me21001–me21005
- **5 Classes** — CS301, CS401, CS202, ECE301, ME201
- **~60 days** of attendance history (realistic patterns)
- **Analytics snapshots** for all students

Expected output:
```
🌱  Attendance System Database Seeder
──────────────────────────────────────────────────
✓  Connected to MongoDB
✓  Created 20 students, 3 faculty, 1 admin
✓  Created 5 classes
✓  Created ~240 QR sessions, ~3500 attendance records
✓  Created analytics snapshots for 20 students

🎉  Seeding complete!
  Admin    →  admin@university.edu     / Password@123
  Faculty  →  faculty1@university.edu  / Password@123
  Student  →  cs21001@university.edu   / Password@123
```

---

## 11. Open the App

| URL | What you see |
|-----|-------------|
| `http://localhost:5173` | React frontend (main app) |
| `http://localhost:3000/health` | Backend health check |
| `http://localhost:8000/docs` | FastAPI Swagger UI (AI service) |
| `http://localhost:8000/health` | AI service health check |

**Login credentials (all use `Password@123`):**

| Role | Email | What you can do |
|------|-------|-----------------|
| Admin | admin@university.edu | Full system oversight, user management |
| Faculty | faculty1@university.edu | Start QR sessions, view class reports |
| Student | cs21001@university.edu | View attendance, scan QR |

---

## 12. Running Services Individually

If you prefer separate terminals:

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev
# Watching for changes... Server on :3000
```

**Terminal 2 — AI Service:**
```bash
cd ai-service
source .venv/bin/activate   # activate venv first
uvicorn main:app --reload --host 0.0.0.0 --port 8000
# INFO: Application startup complete. Listening on 0.0.0.0:8000
```

**Terminal 3 — Frontend:**
```bash
cd frontend
npm run dev
# VITE v5.x ready  ➜  Local: http://localhost:5173/
```

---

## 13. Docker Compose (Alternative)

If Docker is installed, you can run the entire stack with one command — no MongoDB, Redis, or Python setup needed:

```bash
# Build and start everything (first run takes 10–15 min for dlib):
docker-compose up -d

# Watch logs:
docker-compose logs -f

# Seed the database:
docker-compose exec backend node scripts/seed.js

# Stop everything:
docker-compose down

# Stop and delete all data:
docker-compose down -v
```

Services exposed:
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- AI Service: http://localhost:8000

---

## 14. VS Code Shortcuts

| Action | Shortcut | Task Name |
|--------|----------|-----------|
| Start all services | `Ctrl+Shift+P` → Task | `🚀 Start All Services` |
| Run backend tests | `Ctrl+Shift+P` → Task | `🧪 Run Backend Tests` |
| Run AI tests | `Ctrl+Shift+P` → Task | `🧪 Run AI Service Tests` |
| Run E2E tests | `Ctrl+Shift+P` → Task | `🎭 Run E2E Tests` |
| Open Playwright UI | `Ctrl+Shift+P` → Task | `🎭 Open Playwright UI` |
| Health check | `Ctrl+Shift+P` → Task | `💚 Health Check` |
| Seed database | `Ctrl+Shift+P` → Task | `🌱 Seed Database` |
| Train ML model | `Ctrl+Shift+P` → Task | `🤖 Train Risk Model` |
| Debug backend | `F5` | `🟢 Debug Backend (Node.js)` |
| Debug AI service | `F5` | `🐍 Debug AI Service (FastAPI)` |
| Debug tests | `F5` | `🧪 Debug Backend Tests` |
| Format file | `Shift+Alt+F` | — |
| Toggle terminal | `` Ctrl+` `` | — |

---

## 15. Common Errors & Fixes

### ❌ `Error: Cannot find module 'bcryptjs'`
```bash
cd backend && npm install
```

### ❌ `MongooseServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017`
MongoDB is not running. Start it:
```bash
mongod --dbpath ~/data/db
# Or on macOS: brew services start mongodb-community@7.0
```

### ❌ `Error: connect ECONNREFUSED 127.0.0.1:6379`
Redis is not running. Start it:
```bash
redis-server
# Or on macOS: brew services start redis
```

### ❌ `ModuleNotFoundError: No module named 'face_recognition'`
Python virtual environment is not active, or pip install failed:
```bash
cd ai-service
source .venv/bin/activate   # macOS/Linux
# .venv\Scripts\activate    # Windows

pip install face-recognition
```

### ❌ `dlib installation failed` / `cmake not found`
```bash
# macOS:
xcode-select --install
brew install cmake

# Ubuntu:
sudo apt install cmake g++ libopenblas-dev

# Then retry:
pip install dlib face-recognition
```

### ❌ `risk_model.joblib not found` — AI service starts but predictions fail
```bash
npm run train:model
```

### ❌ `JWT_ACCESS_SECRET must be ≥32 chars`
Backend `.env` is missing or has placeholder secrets. Open `backend/.env` and set real values:
```bash
# Generate a proper secret:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### ❌ `CORS error` in browser console
Check `backend/.env`:
```env
ALLOWED_ORIGINS=http://localhost:5173
FRONTEND_URL=http://localhost:5173
```

### ❌ `Port 3000 already in use`
```bash
# Find and kill the process:
# macOS/Linux:
lsof -ti:3000 | xargs kill -9
# Windows:
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### ❌ Face recognition returns 503
AI service is not running, or crashed during dlib load. Check:
```bash
# Is it running?
curl http://localhost:8000/health

# Restart it:
cd ai-service && source .venv/bin/activate
uvicorn main:app --reload --port 8000
```

### ❌ QR scan returns `LOCATION_MISMATCH`
The browser GPS coordinates don't match the classroom coordinates in the session.  
For local testing, use the mock scanner in the UI (GPS returns 42m by default) or  
pass the exact coordinates used when creating the session.

### ❌ Windows: `python3` command not found
Use `python` instead of `python3` — Windows installs as `python`:
```bash
python --version   # Check this works
python -m pip install -r ai-service/requirements.txt
```

---

## 16. API Testing in VS Code

The file `api-tests.http` contains ready-to-use API tests.

1. Install **REST Client** extension (humao.rest-client)
2. Open `api-tests.http`
3. Click **"Send Request"** above any block
4. Copy the `accessToken` from login response into `@adminToken = ...`

---

## 17. Debugging in VS Code

### Debug the Node.js backend
1. Set a breakpoint (click left of line number) in any `.js` file
2. Press `F5` → select `🟢 Debug Backend (Node.js)`
3. Make a request — execution pauses at your breakpoint
4. Inspect variables in the Debug panel (left sidebar)

### Debug the Python AI service
1. Set a breakpoint in any `.py` file
2. Press `F5` → select `🐍 Debug AI Service (FastAPI)`
3. Make a request to `http://localhost:8000/...`
4. Execution pauses at your breakpoint

### Debug both simultaneously
`F5` → `🚀 Debug Backend + AI Service` (compound launch config)

### View MongoDB data
1. Press `Ctrl+Shift+P` → `MongoDB: Connect`
2. Enter: `mongodb://127.0.0.1:27017`
3. Browse collections in the left sidebar
4. Click any document to view/edit it inline

---

## Quick Reference Card

```
Start project:   npm run dev          (from attendance-ai/ root)
Seed data:       npm run seed
Health check:    npm run health
Run tests:       npm test             (backend only)
Train model:     npm run train:model
Build frontend:  npm run build
Docker up:       npm run docker:dev
Docker down:     npm run docker:down

URLs:
  App:     http://localhost:5173
  API:     http://localhost:3000/health
  AI docs: http://localhost:8000/docs

Logins (password: Password@123):
  Admin:   admin@university.edu
  Faculty: faculty1@university.edu
  Student: cs21001@university.edu
```
