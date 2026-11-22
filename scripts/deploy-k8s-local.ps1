# ==============================================================================
# Enterprise Microservices Platform - Local Kubernetes (Kind) Deployment Script
# Provisions a multi-node Kind cluster, loads local Docker images, and applies Kustomize
# ==============================================================================

$ErrorActionPreference = "Stop"
$CLUSTER_NAME = "ecommerce-local-cluster"

Write-Host "`n=======================================================" -ForegroundColor Cyan
Write-Host "   ENTERPRISE PLATFORM: LOCAL KUBERNETES ORCHESTRATION " -ForegroundColor Cyan
Write-Host "=======================================================`n" -ForegroundColor Cyan

# 1. Check Prerequisites
Write-Host ">>> 1. Checking Kind & Kubectl CLI..." -ForegroundColor Yellow
if (-not (Get-Command kind -ErrorAction SilentlyContinue)) {
    Write-Host "Warning: 'kind' CLI is not found in PATH." -ForegroundColor Red
    Write-Host "To install kind on Windows: choco install kind OR winget install Kubernetes.kind" -ForegroundColor Yellow
}
if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) {
    Write-Host "Warning: 'kubectl' CLI is not found in PATH." -ForegroundColor Red
}

# 2. Kind Cluster Provisioning instructions
Write-Host "`n>>> 2. Kind Cluster Provisioning Command:" -ForegroundColor Yellow
Write-Host "kind create cluster --name $CLUSTER_NAME --config k8s/kind-config.yaml" -ForegroundColor Green

# 3. Ingress-NGINX Setup
Write-Host "`n>>> 3. Deploy Ingress-NGINX Controller to Kind:" -ForegroundColor Yellow
Write-Host "kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml" -ForegroundColor Green

# 4. Image Loading
Write-Host "`n>>> 4. Pre-load local Docker images into Kind nodes:" -ForegroundColor Yellow
$services = @("api-gateway", "auth-service", "user-service", "product-service", "order-service", "payment-service", "inventory-service", "notification-service", "frontend")
foreach ($svc in $services) {
    Write-Host "kind load docker-image coporate-project-$svc:latest --name $CLUSTER_NAME" -ForegroundColor DarkGray
}

# 5. Apply All Base Manifests via Kustomize
Write-Host "`n>>> 5. Apply Enterprise Base Manifests via Kustomize:" -ForegroundColor Yellow
Write-Host "kubectl apply -k k8s/base" -ForegroundColor Green

# 6. Verify Rollout
Write-Host "`n>>> 6. Check Rollout Status:" -ForegroundColor Yellow
Write-Host "kubectl get all -n production" -ForegroundColor Green
Write-Host "kubectl get ingress -n production" -ForegroundColor Green
