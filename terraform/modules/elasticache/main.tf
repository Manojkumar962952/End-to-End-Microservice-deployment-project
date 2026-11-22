resource "aws_elasticache_subnet_group" "redis" {
  name       = "ecommerce-redis-subnet-group-${var.environment}"
  subnet_ids = var.subnet_ids
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "ecommerce-redis-${var.environment}"
  description          = "Redis cluster for product caching and rate limiting"
  node_type            = "cache.t4g.small"
  port                 = 6379
  parameter_group_name = "default.redis7"
  subnet_group_name    = aws_elasticache_subnet_group.redis.name
  security_group_ids   = [var.security_group_id]

  automatic_failover_enabled = true
  multi_az_enabled           = true
  num_cache_clusters         = 2

  at_rest_encryption_enabled = true
  transit_encryption_enabled = false

  tags = {
    Name        = "ecommerce-redis-${var.environment}"
    Environment = var.environment
  }
}
