# ==============================================================================
# Enterprise Microservices Platform - Catalog & Inventory Seeder
# Adds initial demo products and warehouse inventory for testing
# ==============================================================================

$GatewayUrl = "http://localhost:8000"

Write-Host "Seeding database with initial catalog products..." -ForegroundColor Cyan

# 1. Login as admin or direct seed via internal network
docker compose exec postgres psql -U postgres -d ecommerce_product -c "
INSERT INTO products (id, name, slug, description, price_cents, currency, is_active)
VALUES 
  ('a0000000-0000-0000-0000-000000000001', 'Enterprise Cloud Architecture Masterclass', 'cloud-masterclass', 'Hands-on production AWS, Kubernetes, Terraform & Microservices', 4999, 'USD', true),
  ('a0000000-0000-0000-0000-000000000002', 'Kubernetes Security & Hardening Guide', 'k8s-security', 'Production pod security standards, RBAC, NetworkPolicies and CIS benchmarks', 2999, 'USD', true),
  ('a0000000-0000-0000-0000-000000000003', 'Site Reliability Engineering Handbook', 'sre-handbook', '4 Golden Signals, Prometheus metrics, distributed tracing and incident drills', 3499, 'USD', true)
ON CONFLICT (id) DO NOTHING;
"

# 2. Seed physical inventory
docker compose exec postgres psql -U postgres -d ecommerce_inventory -c "
INSERT INTO inventory (product_id, total_stock, reserved_stock, updated_at)
VALUES 
  ('a0000000-0000-0000-0000-000000000001', 500, 0, NOW()),
  ('a0000000-0000-0000-0000-000000000002', 250, 0, NOW()),
  ('a0000000-0000-0000-0000-000000000003', 100, 0, NOW())
ON CONFLICT (product_id) DO UPDATE SET total_stock = EXCLUDED.total_stock;
"

Write-Host "Catalog and Inventory seeded successfully!" -ForegroundColor Green
