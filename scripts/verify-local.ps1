# ==============================================================================
# Enterprise Microservices Platform - Local E2E Verification Script
# Executes end-to-end integration tests through the public API Gateway (Port 8000)
# ==============================================================================

$GatewayUrl = "http://localhost:8000"
$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 1. Checking API Gateway Health..." -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

try {
  $health = Invoke-RestMethod -Uri "$GatewayUrl/health/live" -Method Get
  Write-Host "API Gateway is UP:" ($health | ConvertTo-Json -Compress) -ForegroundColor Green
} catch {
  Write-Host "Failed to reach API Gateway at $GatewayUrl. Ensure docker compose up is running." -ForegroundColor Red
  exit 1
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " 2. Testing Customer Registration..." -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$randomSuffix = Get-Random -Minimum 1000 -Maximum 9999
$testEmail = "engineer_$randomSuffix@example.com"
$testPassword = "SecurePassword123!"

$registerPayload = @{
  email = $testEmail
  password = $testPassword
  firstName = "DevOps"
  lastName = "Engineer"
} | ConvertTo-Json

try {
  $regResponse = Invoke-RestMethod -Uri "$GatewayUrl/api/v1/auth/register" -Method Post -Body $registerPayload -ContentType "application/json"
  Write-Host "Registration Successful:" ($regResponse | ConvertTo-Json -Compress) -ForegroundColor Green
} catch {
  Write-Host "Registration failed: $_" -ForegroundColor Red
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " 3. Testing Authentication & JWT Issuance..." -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$loginPayload = @{
  email = $testEmail
  password = $testPassword
} | ConvertTo-Json

$loginResponse = Invoke-RestMethod -Uri "$GatewayUrl/api/v1/auth/login" -Method Post -Body $loginPayload -ContentType "application/json"
$accessToken = $loginResponse.data.accessToken
$refreshToken = $loginResponse.data.refreshToken

Write-Host "Login Successful! Received JWT Access Token (truncated):" $accessToken.Substring(0, 30)... -ForegroundColor Green
Write-Host "Refresh Token:" $refreshToken.Substring(0, 20)... -ForegroundColor Green

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " 4. Testing Refresh Token Rotation (RTR)..." -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$refreshPayload = @{
  refreshToken = $refreshToken
} | ConvertTo-Json

$rotatedResponse = Invoke-RestMethod -Uri "$GatewayUrl/api/v1/auth/refresh" -Method Post -Body $refreshPayload -ContentType "application/json"
$newAccessToken = $rotatedResponse.data.accessToken
Write-Host "Token Rotated Successfully! New JWT Access Token:" $newAccessToken.Substring(0, 30)... -ForegroundColor Green

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " 5. Testing Product Catalog Query..." -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$productsResponse = Invoke-RestMethod -Uri "$GatewayUrl/api/v1/products" -Method Get
Write-Host "Products Fetched:" ($productsResponse | ConvertTo-Json -Compress) -ForegroundColor Green

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " 6. Testing Authenticated Customer Order Placement..." -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$orderPayload = @{
  items = @(
    @{
      productId = "a0000000-0000-0000-0000-000000000001"
      quantity = 2
    }
  )
} | ConvertTo-Json

$orderHeaders = @{
  Authorization = "Bearer $newAccessToken"
  "idempotency-key" = [guid]::NewGuid().ToString()
}

$orderResponse = Invoke-RestMethod -Uri "$GatewayUrl/api/v1/orders" -Method Post -Headers $orderHeaders -Body $orderPayload -ContentType "application/json"
Write-Host "Order Placed Successfully:" ($orderResponse | ConvertTo-Json -Compress) -ForegroundColor Green

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " 7. Verifying Customer Order History..." -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$historyResponse = Invoke-RestMethod -Uri "$GatewayUrl/api/v1/orders" -Method Get -Headers $orderHeaders
Write-Host "Order History Retrieved:" ($historyResponse | ConvertTo-Json -Compress) -ForegroundColor Green

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host " ALL END-TO-END VERIFICATION CHECKS PASSED!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
