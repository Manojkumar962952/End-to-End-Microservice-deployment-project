resource "aws_db_subnet_group" "rds" {
  name       = "ecommerce-db-subnet-group-${var.environment}"
  subnet_ids = var.subnet_ids

  tags = {
    Name = "ecommerce-db-subnet-group-${var.environment}"
  }
}

resource "aws_db_instance" "postgres" {
  identifier            = "ecommerce-postgres-${var.environment}"
  engine                = "postgres"
  engine_version        = "16.1"
  instance_class        = "db.t4g.medium"
  allocated_storage     = 50
  max_allocated_storage = 200
  storage_type          = "gp3"
  storage_encrypted     = true

  multi_az               = true
  publicly_accessible    = false
  db_subnet_group_name   = aws_db_subnet_group.rds.name
  vpc_security_group_ids = [var.security_group_id]

  db_name  = var.database_name
  username = var.admin_username
  password = var.admin_password

  backup_retention_period    = 7
  backup_window              = "03:00-04:00"
  maintenance_window         = "Mon:04:30-Mon:05:30"
  auto_minor_version_upgrade = true
  deletion_protection        = true
  skip_final_snapshot        = false
  final_snapshot_identifier  = "ecommerce-postgres-final-snapshot"

  tags = {
    Name        = "ecommerce-postgres-${var.environment}"
    Environment = var.environment
  }
}
