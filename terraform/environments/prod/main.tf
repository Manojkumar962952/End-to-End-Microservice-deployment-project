terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # Configured for remote state management in S3 with DynamoDB locking
  # backend "s3" {
  #   bucket         = "ecommerce-terraform-state-prod"
  #   key            = "prod/ap-south-1/platform.tfstate"
  #   region         = "ap-south-1"
  #   dynamodb_table = "ecommerce-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = var.environment
      Project     = "Enterprise-ECommerce"
      ManagedBy   = "Terraform"
    }
  }
}

# 1. VPC & Networking Module
module "vpc" {
  source      = "../../modules/vpc"
  environment = var.environment
}

# 2. Security Groups Module
module "security_groups" {
  source      = "../../modules/security-groups"
  vpc_id      = module.vpc.vpc_id
  environment = var.environment
}

# 3. ECR Repositories Module
module "ecr" {
  source      = "../../modules/ecr"
  environment = var.environment
}

# 4. Amazon EKS Cluster Module
module "eks" {
  source                 = "../../modules/eks"
  cluster_name           = "ecommerce-eks"
  environment            = var.environment
  vpc_id                 = module.vpc.vpc_id
  subnet_ids             = module.vpc.private_app_subnet_ids
  node_security_group_id = module.security_groups.eks_nodes_security_group_id
}

# 5. Amazon RDS PostgreSQL Multi-AZ Module
module "rds" {
  source            = "../../modules/rds"
  environment       = var.environment
  subnet_ids        = module.vpc.private_db_subnet_ids
  security_group_id = module.security_groups.rds_security_group_id
  admin_password    = var.db_admin_password
}

# 6. Amazon ElastiCache Redis Module
module "elasticache" {
  source            = "../../modules/elasticache"
  environment       = var.environment
  subnet_ids        = module.vpc.private_db_subnet_ids
  security_group_id = module.security_groups.redis_security_group_id
}
