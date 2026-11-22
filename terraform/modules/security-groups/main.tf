# 1. Public ALB Security Group (Allows HTTPS 443 from Internet)
resource "aws_security_group" "alb" {
  name        = "ecommerce-alb-sg-${var.environment}"
  description = "Allows public HTTPS ingress from internet"
  vpc_id      = var.vpc_id

  ingress {
    description = "Allow HTTPS from anywhere"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Allow HTTP for redirect to HTTPS"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Allow all outbound traffic to worker nodes"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "ecommerce-alb-sg-${var.environment}"
    Environment = var.environment
  }
}

# 2. EKS Node Security Group (Only accepts traffic from ALB or internal nodes)
resource "aws_security_group" "eks_nodes" {
  name        = "ecommerce-eks-nodes-sg-${var.environment}"
  description = "Security group for EKS worker nodes"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Allow traffic from ALB to worker node NodePorts / Pods"
    from_port       = 0
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    description = "Allow node-to-node communication across cluster"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    self        = true
  }

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "ecommerce-eks-nodes-sg-${var.environment}"
    Environment = var.environment
  }
}

# 3. RDS PostgreSQL Security Group (ONLY accepts port 5432 from EKS Nodes SG)
resource "aws_security_group" "rds" {
  name        = "ecommerce-rds-sg-${var.environment}"
  description = "Allows PostgreSQL traffic strictly from EKS Nodes"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from EKS Nodes SG"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.eks_nodes.id]
  }

  egress {
    description = "Disallow outbound internet traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/16"]
  }

  tags = {
    Name        = "ecommerce-rds-sg-${var.environment}"
    Environment = var.environment
  }
}

# 4. ElastiCache Redis Security Group (ONLY accepts port 6379 from EKS Nodes SG)
resource "aws_security_group" "redis" {
  name        = "ecommerce-redis-sg-${var.environment}"
  description = "Allows Redis traffic strictly from EKS Nodes"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Redis from EKS Nodes SG"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.eks_nodes.id]
  }

  egress {
    description = "Disallow outbound internet traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/16"]
  }

  tags = {
    Name        = "ecommerce-redis-sg-${var.environment}"
    Environment = var.environment
  }
}
