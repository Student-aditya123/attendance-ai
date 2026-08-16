###############################################################################
# infra/terraform/variables.tf
###############################################################################
variable "aws_region"     { type = string; default = "us-east-1" }
variable "project_name"   { type = string; default = "attendance" }
variable "environment"    { type = string }                            # prod | staging
variable "vpc_cidr"       { type = string; default = "10.0.0.0/16" }
variable "redis_node_type"{ type = string; default = "cache.t4g.micro" }
variable "github_org"     { type = string }
variable "github_repo"    { type = string; default = "attendance-ai" }
variable "s3_bucket_name" { type = string }
variable "alb_logs_bucket"{ type = string; default = "" }
variable "acm_certificate_arn" { type = string }
variable "sns_alert_arn"  { type = string; default = "" }

###############################################################################
# infra/terraform/outputs.tf
###############################################################################
output "ecr_backend_url"   { value = aws_ecr_repository.backend.repository_url }
output "ecr_ai_url"        { value = aws_ecr_repository.ai_service.repository_url }
output "ecs_cluster_name"  { value = aws_ecs_cluster.main.name }
output "alb_dns_name"      { value = aws_lb.main.dns_name }
output "redis_endpoint"    { value = aws_elasticache_replication_group.redis.primary_endpoint_address }
output "frontend_bucket"   { value = aws_s3_bucket.frontend.bucket }
output "cloudfront_domain" { value = aws_cloudfront_distribution.frontend.domain_name }
output "github_actions_role_arn" { value = aws_iam_role.github_actions.arn }
