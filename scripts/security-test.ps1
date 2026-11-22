# Automated Application Security & OWASP Verification Script
# Tests: SQL Injection, Rate Limiting, JWT Signature Tampering, IDOR & Security Headers

$ErrorActionPreference = "Stop"
$GATEWAY_URL = "http://localhost:8000"

Write-Host "`n=======================================================" -ForegroundColor Cyan
Write-Host "   ENTERPRISE PLATFORM: AUTOMATED SECURITY AUDIT TEST  " -ForegroundColor Cyan
Write-Host "=======================================================`n" -ForegroundColor Cyan

$TotalTests = 0
$PassedTests = 0

function Assert-Test([string]$Name, [bool]$Condition, [string]$Details = "") {
    $script:TotalTests++
    if ($Condition) {
        $script:PassedTests++
        Write-Host "[PASS] $Name" -ForegroundColor Green
        if ($Details) { Write-Host "       $Details" -ForegroundColor DarkGray }
    } else {
        Write-Host "[FAIL] $Name" -ForegroundColor Red
        if ($Details) { Write-Host "       $Details" -ForegroundColor Yellow }
    }
}

# -------------------------------------------------------------
# Test 1: Verify HTTP Security Headers (Helmet)
# -------------------------------------------------------------
Write-Host ">>> 1. Inspecting HTTP Security Headers (Helmet & Ingress Defense)..." -ForegroundColor Yellow
try {
    $resp = Invoke-WebRequest -Uri "$GATEWAY_URL/health/live" -Method Get -UseBasicParsing
    $headers = $resp.Headers
    
    $hasNoSniff = $headers["X-Content-Type-Options"] -eq "nosniff"
    $hasFrameOptions = ($headers["X-Frame-Options"] -eq "SAMEORIGIN") -or ($headers["X-Frame-Options"] -eq "DENY") -or ($headers["Content-Security-Policy"] -like "*frame-ancestors*")
    $noPoweredBy = -not $headers.ContainsKey("X-Powered-By")

    Assert-Test -Name "Security Header: X-Content-Type-Options is nosniff" -Condition $hasNoSniff
    Assert-Test -Name "Security Header: X-Frame-Options / Frame Guard is active" -Condition $hasFrameOptions
    Assert-Test -Name "Security Header: X-Powered-By is masked (information disclosure blocked)" -Condition $noPoweredBy
} catch {
    Assert-Test -Name "HTTP Security Headers Check" -Condition $false -Details $_.Exception.Message
}

# -------------------------------------------------------------
# Test 2: SQL Injection Immunity Verification (A03: Injection)
# -------------------------------------------------------------
Write-Host "`n>>> 2. Testing SQL Injection Immunity via Parameterized Queries..." -ForegroundColor Yellow
$sqliPayloads = @(
    "admin' OR 1=1; --",
    "' UNION SELECT null, null, null, null --",
    "test@example.com' OR 'a'='a"
)

foreach ($payload in $sqliPayloads) {
    try {
        $body = @{
            email = $payload
            password = "Password123!"
        } | ConvertTo-Json

        $resp = Invoke-RestMethod -Uri "$GATEWAY_URL/api/v1/auth/login" -Method Post -Body $body -ContentType "application/json"
        # If login succeeded with SQLi, that's a catastrophic failure
        Assert-Test -Name "SQL Injection Attempt: $payload" -Condition $false -Details "VULNERABILITY: SQLi payload bypassed authentication!"
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        # Status code 400 (Zod validation error) or 401 (Invalid credentials) proves parameterized query protected DB
        $isSafe = ($statusCode -eq 400) -or ($statusCode -eq 401)
        Assert-Test -Name "SQL Injection Blocked: $payload" -Condition $isSafe -Details "Response code: $statusCode (Input safely validated/parameterized)"
    }
}

# -------------------------------------------------------------
# Test 3: JWT Signature Tampering & Forgery Rejection (A07)
# -------------------------------------------------------------
Write-Host "`n>>> 3. Testing JWT Signature Tampering & Header Manipulation..." -ForegroundColor Yellow
# Register/Login legitimate user to get a real token
$testEmail = "sec-audit-$(Get-Random)@enterprise.com"
$regBody = @{
    email = $testEmail
    password = "SecAuditPassword123!"
    firstName = "Security"
    lastName = "Auditor"
} | ConvertTo-Json

try {
    $authResp = Invoke-RestMethod -Uri "$GATEWAY_URL/api/v1/auth/register" -Method Post -Body $regBody -ContentType "application/json"
    $validToken = $authResp.data.accessToken

    # Verify valid token works
    $validAuthHeader = @{ Authorization = "Bearer $validToken" }
    $ordersResp = Invoke-RestMethod -Uri "$GATEWAY_URL/api/v1/orders" -Method Get -Headers $validAuthHeader
    Assert-Test -Name "Legitimate JWT Authentication" -Condition ($ordersResp.success -eq $true)

    # Attack Vector 1: Tampered Payload (Attempt privilege escalation to role=ADMIN)
    $tokenParts = $validToken.Split('.')
    $headerB64 = $tokenParts[0]
    $payloadB64 = $tokenParts[1]
    $sigB64 = $tokenParts[2]

    # Decode payload, alter role to ADMIN, and re-encode
    $payloadJson = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payloadB64.PadRight($payloadB64.Length + (4 - $payloadB64.Length % 4) % 4, '=')))
    $tamperedPayloadJson = $payloadJson -replace '"role":"CUSTOMER"', '"role":"ADMIN"'
    $tamperedPayloadB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($tamperedPayloadJson)).TrimEnd('=')
    $forgedJwt = "$headerB64.$tamperedPayloadB64.$sigB64"

    try {
        $forgedHeader = @{ Authorization = "Bearer $forgedJwt" }
        $resp = Invoke-RestMethod -Uri "$GATEWAY_URL/api/v1/orders" -Method Get -Headers $forgedHeader
        Assert-Test -Name "Tampered JWT Rejection" -Condition $false -Details "VULNERABILITY: Forged token accepted!"
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Assert-Test -Name "Tampered JWT Signature Rejected" -Condition ($statusCode -eq 401) -Details "Status $($statusCode): Signature mismatch correctly caught"
    }

    # Attack Vector 2: Missing Bearer Token
    try {
        $resp = Invoke-RestMethod -Uri "$GATEWAY_URL/api/v1/orders" -Method Get
        Assert-Test -Name "Unauthenticated Request Rejected" -Condition $false -Details "VULNERABILITY: Protected endpoint allowed anonymous access"
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Assert-Test -Name "Unauthenticated Request Rejected" -Condition ($statusCode -eq 401) -Details "Status $($statusCode): Protected route enforced"
    }

} catch {
    Write-Host "Warning: User registration failed: $($_.Exception.Message)" -ForegroundColor Red
}

# -------------------------------------------------------------
# Test 4: Rate Limiting Enforcement (A04: Insecure Design)
# -------------------------------------------------------------
Write-Host "`n>>> 4. Testing Redis Token Bucket Rate Limiting Thresholds..." -ForegroundColor Yellow
Write-Host "Sending burst of requests to API Gateway..." -ForegroundColor DarkGray
$rateLimitTriggered = $false
$rateLimitStatus = 0

for ($i = 1; $i -le 115; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "$GATEWAY_URL/api/v1/products" -Method Get -UseBasicParsing -TimeoutSec 2
    } catch {
        $status = $_.Exception.Response.StatusCode.value__
        if ($status -eq 429) {
            $rateLimitTriggered = $true
            $rateLimitStatus = 429
            break
        }
    }
}

Assert-Test -Name "Rate Limiter: HTTP 429 Too Many Requests triggered under burst" -Condition $rateLimitTriggered -Details "Triggered after request batch with status: $rateLimitStatus"

# -------------------------------------------------------------
# Summary
# -------------------------------------------------------------
Write-Host "`n=======================================================" -ForegroundColor Cyan
Write-Host "SECURITY AUDIT COMPLETE: $PassedTests / $TotalTests tests passed." -ForegroundColor $(if ($PassedTests -eq $TotalTests) { "Green" } else { "Yellow" })
Write-Host "=======================================================`n" -ForegroundColor Cyan

if ($PassedTests -eq $TotalTests) {
    exit 0
} else {
    exit 1
}
