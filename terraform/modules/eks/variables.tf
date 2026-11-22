variable "cluster_name" {
  type    = string
  default = "ecommerce-eks-cluster"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Private application subnet IDs"
  type        = list(string)
}

variable "node_security_group_id" {
  type = string
}

variable "kubernetes_version" {
  type    = string
  default = "1.29"
}
