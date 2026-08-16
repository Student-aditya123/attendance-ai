###############################################################################
# infra/terraform/ecs_services.tf
#
# ECS Fargate service definitions for the two application containers.
# Separated from main.tf to keep file sizes manageable.
#
# What this provisions:
#   - Backend ECS service (2 tasks, rolling update)
#   - AI service ECS service (1 task — not load-balanced, internal only)
#   - Task definitions for both services
#   - Service discovery so backend can reach AI service by hostname
###############################################################################

# ── Service Discovery (Cloud Map) ─────────────────────────────────────────────
# Lets the backend reach the AI service via http://ai-service.attendance.internal:8000
resource "aws_service_discovery_private_dns_namespace" "internal" {
  name        = "attendance.internal"
  description = "Internal service discovery for AttendanceAI"
  vpc         = aws_vpc.main.id
}

resource "aws_service_discovery_service" "ai" {
  name = "ai-service"
  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.internal.id
    routing_policy = "MULTIVALUE"
    dns_records {
      ttl  = 10
      type = "A"
    }
  }
  health_check_custom_config { failure_threshold = 1 }
}

# ── Backend task definition ────────────────────────────────────────────────────
resource "aws_ecs_task_definition" "backend" {
  family                   = "${local.name_prefix}-backend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.backend_cpu    # 512 dev, 1024 prod
  memory                   = var.backend_memory # 1024 dev, 2048 prod
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "attendance-backend"
    image     = "${aws_ecr_repository.backend.repository_url}:${var.image_tag}"
    essential = true

    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]

    environment = [
      { name = "NODE_ENV",           value = var.environment },
      { name = "PORT",               value = "3000" },
      { name = "AWS_REGION",         value = var.aws_region },
      { name = "QR_TOKEN_TTL_SECS",  value = "45" },
      { name = "QR_LOCATION_RADIUS", value = "100" },
      { name = "MIN_ATTENDANCE_PCT", value = "75" },
      { name = "BCRYPT_ROUNDS",      value = "12" },
      { name = "JWT_ACCESS_TTL",     value = "15m" },
      { name = "JWT_REFRESH_TTL",    value = "7d" },
      # AI service reached via Cloud Map service discovery
      { name = "AI_SERVICE_URL",     value = "http://ai-service.attendance.internal:8000" },
      { name = "FRONTEND_URL",       value = "https://${var.frontend_domain}" },
      { name = "ALLOWED_ORIGINS",    value = "https://${var.frontend_domain}" },
    ]

    # Secrets from SSM Parameter Store — never in plaintext env vars
    secrets = [
      { name = "MONGO_URI",          valueFrom = "/attendance/${var.environment}/MONGO_URI" },
      { name = "REDIS_URL",          valueFrom = "/attendance/${var.environment}/REDIS_URL" },
      { name = "JWT_ACCESS_SECRET",  valueFrom = "/attendance/${var.environment}/JWT_ACCESS_SECRET" },
      { name = "JWT_REFRESH_SECRET", valueFrom = "/attendance/${var.environment}/JWT_REFRESH_SECRET" },
      { name = "SMTP_HOST",          valueFrom = "/attendance/${var.environment}/SMTP_HOST" },
      { name = "SMTP_USER",          valueFrom = "/attendance/${var.environment}/SMTP_USER" },
      { name = "SMTP_PASS",          valueFrom = "/attendance/${var.environment}/SMTP_PASS" },
      { name = "AWS_BUCKET_NAME",    valueFrom = "/attendance/${var.environment}/AWS_BUCKET_NAME" },
    ]

    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:3000/health || exit 1"]
      interval    = 20
      timeout     = 8
      retries     = 3
      startPeriod = 30
    }

    logConfiguration = {
      logDriver = "awslogs"
      options   = {
        "awslogs-group"         = aws_cloudwatch_log_group.backend.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }

    ulimits = [{
      name      = "nofile"
      softLimit = 65535
      hardLimit = 65535
    }]
  }])

  tags = { Component = "backend" }
}

# ── Backend ECS service ────────────────────────────────────────────────────────
resource "aws_ecs_service" "backend" {
  name            = "${local.name_prefix}-backend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = var.backend_desired_count   # 2 for prod, 1 for dev
  launch_type     = "FARGATE"

  # Rolling update: always keep ≥1 task healthy during deploy
  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.backend_tasks.id]
    assign_public_ip = false   # tasks in private subnet, reach internet via NAT
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "attendance-backend"
    container_port   = 3000
  }

  # Prevent Terraform from resetting task count if auto-scaling changes it
  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener.https]
}

# ── AI service task definition ─────────────────────────────────────────────────
resource "aws_ecs_task_definition" "ai_service" {
  family                   = "${local.name_prefix}-ai"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.ai_cpu         # 2048 (face_recognition is CPU-heavy)
  memory                   = var.ai_memory      # 4096
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "attendance-ai"
    image     = "${aws_ecr_repository.ai_service.repository_url}:${var.image_tag}"
    essential = true

    portMappings = [{ containerPort = 8000, protocol = "tcp" }]

    environment = [
      { name = "APP_ENV",                 value = var.environment },
      { name = "PORT",                    value = "8000" },
      { name = "LOG_LEVEL",               value = "info" },
      { name = "AWS_REGION",              value = var.aws_region },
      { name = "FACE_DISTANCE_THRESHOLD", value = "0.50" },
      { name = "FACE_MIN_CONFIDENCE",     value = "0.80" },
      { name = "RISK_MODEL_PATH",         value = "/app/models/risk_model.joblib" },
      { name = "MIN_ATTENDANCE_PCT",      value = "75.0" },
    ]

    secrets = [
      { name = "MONGO_URI",       valueFrom = "/attendance/${var.environment}/MONGO_URI" },
      { name = "AWS_BUCKET_NAME", valueFrom = "/attendance/${var.environment}/AWS_BUCKET_NAME" },
    ]

    healthCheck = {
      command     = ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://localhost:8000/health')\""]
      interval    = 30
      timeout     = 10
      retries     = 3
      startPeriod = 45    # dlib model loading takes ~10s on cold start
    }

    logConfiguration = {
      logDriver = "awslogs"
      options   = {
        "awslogs-group"         = aws_cloudwatch_log_group.ai_service.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])

  tags = { Component = "ai-service" }
}

# ── AI service ECS service (no load balancer — internal only via Cloud Map) ────
resource "aws_ecs_service" "ai_service" {
  name            = "${local.name_prefix}-ai"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.ai_service.arn
  desired_count   = var.ai_desired_count   # 1 for dev/staging, 2 for prod
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ai_tasks.id]
    assign_public_ip = false
  }

  # Register with Cloud Map so backend can find it by hostname
  service_registries {
    registry_arn = aws_service_discovery_service.ai.arn
  }

  lifecycle {
    ignore_changes = [desired_count]
  }
}

# ── Auto-scaling for backend ───────────────────────────────────────────────────
resource "aws_appautoscaling_target" "backend" {
  max_capacity       = 8
  min_capacity       = var.backend_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.backend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# Scale out when CPU > 70% for 2 consecutive minutes
resource "aws_appautoscaling_policy" "backend_cpu" {
  name               = "${local.name_prefix}-backend-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  service_namespace  = aws_appautoscaling_target.backend.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 70.0
    scale_in_cooldown  = 300   # 5 min cooldown on scale-in (prevent flapping)
    scale_out_cooldown = 60    # 1 min on scale-out (react fast to spikes)

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# ── Additional Terraform variables for this file ───────────────────────────────
variable "image_tag"              { type = string; default = "latest" }
variable "backend_cpu"            { type = number; default = 512 }
variable "backend_memory"         { type = number; default = 1024 }
variable "backend_desired_count"  { type = number; default = 2 }
variable "ai_cpu"                 { type = number; default = 2048 }
variable "ai_memory"              { type = number; default = 4096 }
variable "ai_desired_count"       { type = number; default = 1 }
variable "frontend_domain"        { type = string }
