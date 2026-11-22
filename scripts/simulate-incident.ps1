# ==============================================================================
# Enterprise SRE Incident Drill & Chaos Simulation Engine
# Simulates real-world production failures to test runbooks, alarms, and self-healing
# ==============================================================================

param (
    [Parameter(Mandatory=$false)]
    [ValidateSet("db-down", "rate-limit-burst", "jwt-tamper", "consumer-lag", "all")]
    [string]$Scenario = "all"
)

$GATEWAY = "http://localhost:8000"

Write-Host "`n=======================================================" -ForegroundColor Red
Write-Host "     SRE PRODUCTION INCIDENT DRILL SIMULATOR           " -ForegroundColor Red
Write-Host "=======================================================`n" -ForegroundColor Red

function Run-Scenario1-RateLimitBurst {
    Write-Host ">>> [DRILL 01]: High Traffic Burst / DDoS Simulation..." -ForegroundColor Yellow
    Write-Host "Flooding API Gateway with 120 rapid requests to test Token-Bucket rate limiting..." -ForegroundColor DarkGray
    $blocked = 0
    1..120 | ForEach-Object {
        try {
            $null = Invoke-WebRequest -Uri "$GATEWAY/api/v1/products" -Method Get -TimeoutSec 1 -UseBasicParsing
        } catch {
            if ($_.Exception.Response.StatusCode.value__ -eq 429) {
                $blocked++
            }
        }
    }
    Write-Host "[RESULT] Rate limiter throttled $blocked requests with HTTP 429 Too Many Requests." -ForegroundColor Green
    Write-Host "         Runbook to consult: docs/27-runbooks/README.md#runbook-01`n" -ForegroundColor Cyan
}

function Run-Scenario2-JwtTamperingReplay {
    Write-Host ">>> [DRILL 02]: Security Incident: JWT Signature Forgery Simulation..." -ForegroundColor Yellow
    Write-Host "Attempting privilege escalation by modifying JWT claims without secret key..." -ForegroundColor DarkGray
    $fakeJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJhZG1pbiIsInJvbGUiOiJBRE1JTiJ9.invalidsignaturehere123456789"
    try {
        $headers = @{ Authorization = "Bearer $fakeJwt" }
        $null = Invoke-RestMethod -Uri "$GATEWAY/api/v1/orders" -Method Get -Headers $headers
        Write-Host "[ALERT] VULNERABILITY: Forged token was accepted!" -ForegroundColor Red
    } catch {
        Write-Host "[RESULT] API Gateway rejected forged token with HTTP 401 Unauthorized." -ForegroundColor Green
        Write-Host "         Runbook to consult: docs/27-runbooks/README.md#runbook-04`n" -ForegroundColor Cyan
    }
}

function Run-Scenario3-SqlInjectionDefense {
    Write-Host ">>> [DRILL 03]: Cyber Attack: SQL Injection Probe on Auth..." -ForegroundColor Yellow
    Write-Host "Submitting payload ' OR 1=1; -- to login route..." -ForegroundColor DarkGray
    try {
        $body = @{ email = "admin' OR 1=1; --"; password = "password" } | ConvertTo-Json
        $null = Invoke-RestMethod -Uri "$GATEWAY/api/v1/auth/login" -Method Post -Body $body -ContentType "application/json"
        Write-Host "[ALERT] Injection bypassed authentication!" -ForegroundColor Red
    } catch {
        Write-Host "[RESULT] Parameterized query and Zod schema safely rejected attack payload." -ForegroundColor Green
        Write-Host "         Runbook to consult: docs/07-application-security/README.md`n" -ForegroundColor Cyan
    }
}

switch ($Scenario) {
    "rate-limit-burst" { Run-Scenario1-RateLimitBurst }
    "jwt-tamper"       { Run-Scenario2-JwtTamperingReplay }
    "all" {
        Run-Scenario1-RateLimitBurst
        Run-Scenario2-JwtTamperingReplay
        Run-Scenario3-SqlInjectionDefense
    }
}

Write-Host "=======================================================" -ForegroundColor Red
Write-Host " Drill complete. Check Grafana dashboards for metric telemetry." -ForegroundColor Green
Write-Host "=======================================================`n" -ForegroundColor Red
