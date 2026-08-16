# Makefile — AttendanceAI project commands
#
# Usage:  make <target>
# Run     make help   for a list of all targets

.PHONY: help dev dev-down prod prod-down \
        seed seed-reset \
        test test-backend test-ai test-watch \
        lint lint-fix \
        build build-backend build-ai build-frontend \
        logs logs-backend logs-ai \
        train-model \
        clean

# ── Detect OS for open-browser command ────────────────────────────────────────
UNAME := $(shell uname)
ifeq ($(UNAME), Darwin)
  OPEN := open
else
  OPEN := xdg-open
endif

# Colours
GREEN  := \033[0;32m
YELLOW := \033[0;33m
RESET  := \033[0m

help: ## Show this help
	@echo ""
	@echo "  $(GREEN)AttendanceAI$(RESET) — Available commands"
	@echo ""
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  $(YELLOW)%-20s$(RESET) %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""


# ── Development ────────────────────────────────────────────────────────────────

dev: ## Start full dev stack (MongoDB + Redis + Node API + AI + React)
	docker-compose up -d mongodb redis
	@echo "$(GREEN)Waiting for DB services…$(RESET)"
	@sleep 3
	docker-compose up backend ai-service frontend
	
dev-d: ## Start dev stack in background
	docker-compose up -d

dev-down: ## Stop dev stack
	docker-compose down

dev-reset: ## Stop dev stack and remove volumes (fresh start)
	docker-compose down -v
	@echo "$(GREEN)Dev environment reset ✓$(RESET)"

seed: ## Seed the database with demo data
	NODE_PATH=backend node scripts/seed.js

seed-reset: ## Drop existing data and re-seed
	NODE_PATH=backend node scripts/seed.js --reset


# ── Testing ────────────────────────────────────────────────────────────────────

test: test-backend test-ai ## Run all tests

test-backend: ## Run backend unit + integration tests
	@echo "$(GREEN)Running backend tests…$(RESET)"
	cd backend && NODE_ENV=test \
		MONGO_URI=mongodb://localhost:27017/attendance_test \
		REDIS_URL=redis://localhost:6379 \
		JWT_ACCESS_SECRET=test-access-secret-at-least-32-chars \
		JWT_REFRESH_SECRET=test-refresh-secret-at-least-32-chars \
		npm test

test-ai: ## Run AI service tests
	@echo "$(GREEN)Running AI service tests…$(RESET)"
	cd ai-service && \
		RISK_MODEL_PATH=models/risk_model.joblib \
		AWS_BUCKET_NAME=test \
		MONGO_URI=mongodb://localhost:27017/test \
		pytest tests/ -v --tb=short

test-watch: ## Run backend tests in watch mode
	cd backend && npm run test -- --watch


# ── Linting ────────────────────────────────────────────────────────────────────

lint: ## Run all linters
	@echo "$(GREEN)Linting backend (ESLint)…$(RESET)"
	cd backend && npx eslint src --ext .js
	@echo "$(GREEN)Linting AI service (Black + Ruff)…$(RESET)"
	cd ai-service && black --check . && ruff check .

lint-fix: ## Auto-fix lint issues
	cd backend && npx eslint src --ext .js --fix
	cd ai-service && black . && ruff check . --fix


# ── Building ───────────────────────────────────────────────────────────────────

build: build-backend build-ai build-frontend ## Build all Docker images

build-backend: ## Build backend Docker image
	docker build -t attendance-backend:local backend/ --target runtime

build-ai: ## Build AI service Docker image
	docker build -t attendance-ai:local ai-service/

build-frontend: ## Build React frontend
	cd frontend && npm run build

push-ecr: ## Push images to ECR (requires AWS credentials + IMAGE_TAG env var)
	@[ -n "$(ECR_REGISTRY)" ] || (echo "ECR_REGISTRY not set" && exit 1)
	@[ -n "$(IMAGE_TAG)" ]    || (echo "IMAGE_TAG not set" && exit 1)
	aws ecr get-login-password --region $(AWS_REGION) | \
		docker login --username AWS --password-stdin $(ECR_REGISTRY)
	docker tag attendance-backend:local $(ECR_REGISTRY)/attendance-backend:$(IMAGE_TAG)
	docker tag attendance-ai:local      $(ECR_REGISTRY)/attendance-ai:$(IMAGE_TAG)
	docker push $(ECR_REGISTRY)/attendance-backend:$(IMAGE_TAG)
	docker push $(ECR_REGISTRY)/attendance-ai:$(IMAGE_TAG)
	@echo "$(GREEN)Images pushed to ECR ✓$(RESET)"


# ── Production ─────────────────────────────────────────────────────────────────

prod: ## Start production stack
	docker-compose -f docker-compose.prod.yml up -d

prod-down: ## Stop production stack
	docker-compose -f docker-compose.prod.yml down

prod-deploy: ## Deploy latest images to production (requires env vars)
	docker-compose -f docker-compose.prod.yml pull
	docker-compose -f docker-compose.prod.yml up -d --no-build


# ── ML Model ───────────────────────────────────────────────────────────────────

train-model: ## Generate training data and train the risk model
	@echo "$(GREEN)Generating synthetic training data…$(RESET)"
	cd ai-service && python training/generate_sample_data.py \
		--samples 15000 --out data/training.csv
	@echo "$(GREEN)Training risk model…$(RESET)"
	cd ai-service && python training/train_risk_model.py \
		--data data/training.csv \
		--model-out models/risk_model.joblib \
		--eval

train-model-real: ## Train on REAL data from MongoDB (production use)
	@echo "$(YELLOW)Fetching real attendance data from MongoDB…$(RESET)"
	cd ai-service && python training/export_real_data.py \
		--uri $(MONGO_URI) --out data/real_training.csv
	cd ai-service && python training/train_risk_model.py \
		--data data/real_training.csv \
		--model-out models/risk_model.joblib \
		--eval


# ── Logs ───────────────────────────────────────────────────────────────────────

logs: ## Tail all service logs
	docker-compose logs -f

logs-backend: ## Tail backend logs
	docker-compose logs -f backend

logs-ai: ## Tail AI service logs
	docker-compose logs -f ai-service

logs-nginx: ## Tail Nginx logs
	docker-compose -f docker-compose.prod.yml logs -f nginx


# ── Utilities ──────────────────────────────────────────────────────────────────

open: ## Open the app in a browser
	$(OPEN) http://localhost:5173

open-api: ## Open the API docs in a browser
	$(OPEN) http://localhost:3000/health

open-ai-docs: ## Open AI service Swagger docs
	$(OPEN) http://localhost:8000/docs

shell-backend: ## Open a shell in the backend container
	docker-compose exec backend sh

shell-ai: ## Open a shell in the AI service container
	docker-compose exec ai-service bash

mongo-shell: ## Open MongoDB shell
	docker-compose exec mongodb mongosh attendance_db

redis-cli: ## Open Redis CLI
	docker-compose exec redis redis-cli

clean: ## Remove all build artifacts and temp files
	rm -rf backend/coverage backend/node_modules/.cache
	rm -rf ai-service/__pycache__ ai-service/**/__pycache__
	rm -rf ai-service/data/*.csv
	rm -rf frontend/dist
	find . -name "*.pyc" -delete
	@echo "$(GREEN)Clean complete ✓$(RESET)"
