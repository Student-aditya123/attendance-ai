# infra/terraform/environments/prod/terraform.tfvars
# Copy this file and fill in your real values before running terraform apply.
# NEVER commit this file with real values — it is in .gitignore.

environment    = "prod"
aws_region     = "us-east-1"
project_name   = "attendance"

# VPC
vpc_cidr       = "10.0.0.0/16"

# ElastiCache — upgrade to r7g.large for >5,000 concurrent users
redis_node_type = "cache.r7g.large"

# GitHub OIDC — your GitHub org and repo
github_org     = "your-org"
github_repo    = "attendance-ai"

# S3 — face encodings bucket (must already exist)
s3_bucket_name = "attendance-face-data-prod"

# ALB access logs bucket (optional)
alb_logs_bucket = "attendance-alb-logs-prod"

# ACM Certificate (must already exist in us-east-1 for CloudFront)
acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/..."

# SNS topic for CloudWatch alarms (optional — leave empty to disable)
sns_alert_arn = "arn:aws:sns:us-east-1:123456789012:attendance-alerts"
