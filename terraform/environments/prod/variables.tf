variable "aws_region" {
  description = "AWS deployment region"
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "db_admin_password" {
  description = "Master password for RDS PostgreSQL"
  type        = string
  sensitive   = true
}
