variable "subnet_ids" {
  description = "Private database subnets"
  type        = list(string)
}

variable "security_group_id" {
  description = "Security group for RDS"
  type        = string
}

variable "environment" {
  type    = string
  default = "production"
}

variable "database_name" {
  type    = string
  default = "ecommerce_main"
}

variable "admin_username" {
  type    = string
  default = "ecommerce_admin"
}

variable "admin_password" {
  type      = string
  sensitive = true
}
