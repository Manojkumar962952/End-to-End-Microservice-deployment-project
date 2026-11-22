variable "services" {
  description = "List of microservices requiring ECR repositories"
  type        = list(string)
  default = [
    "api-gateway",
    "auth-service",
    "user-service",
    "product-service",
    "order-service",
    "payment-service",
    "inventory-service",
    "notification-service",
    "frontend"
  ]
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"
}
