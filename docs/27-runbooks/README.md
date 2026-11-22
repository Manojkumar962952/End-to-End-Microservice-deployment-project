# Chapter 27: Production SRE Incident Response Runbooks & Playbooks

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                               SRE PRODUCTION INCIDENT RUNBOOK MATRIX                      |
+───────────────────────────────────────────────────────────────────────────────────────────+
| RUNBOOK 01: High HTTP 5xx Error Rate Spike (>1%) on API Gateway                           |
| RUNBOOK 02: PostgreSQL Connection Pool Exhaustion (`too many clients already`)            |
| RUNBOOK 03: RabbitMQ Queue Backlog Surging & Consumer Starvation                          |
| RUNBOOK 04: Kubernetes Pod CrashLoopBackOff & OOMKilled Emergency Drain                   |
| RUNBOOK 05: Redis Cache Eviction Storm & Database Stampede Mitigations                    |
| RUNBOOK 06: Zero-Downtime Rollback Execution on Broken Canary Release                     |
| RUNBOOK 07: Disk Space Exhaustion on Worker Node Root Filesystem                          |
| RUNBOOK 08: Intermittent DNS Resolution Failures (CoreDNS Degradation)                    |
| RUNBOOK 09: TLS / SSL Certificate Expiration Emergency Renewal Drill                      |
| RUNBOOK 10: Security Incident: Compromised JWT Secret & Immediate Family Revocation      |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
An SRE Runbook (or Playbook) is a formal, step-by-step technical operational procedure documented by Site Reliability Engineers to diagnose, mitigate, and resolve specific production alerts, system degradations, or catastrophic outages during on-call incidents.

---

## 2. Why Do Companies Prioritize It?
- **Removes Panic from 3 AM Incidents**: Under high pressure and sleep deprivation, human cognitive performance drops drastically. Standardized runbooks provide deterministic, copy-pasteable commands and decision trees.
- **Reduces MTTR (Mean Time to Resolution)**: Eliminates time spent searching through past Slack threads or guessing diagnostic commands.
- **Auditable Compliance**: SOC 2 and ISO 27001 require formalized, documented disaster and incident response procedures.

---

## 3. What Problem Does It Solve?
- **Knowledge Silos**: Ensures any engineer on call—regardless of whether they authored the original microservice—can safely triage and resolve incidents.
- **Accidental Escalation of Outages**: Prevents an inexperienced engineer from running destructive commands (like `DROP TABLE` or restarting all database nodes at once) during an ongoing incident.

---

## 4. How Does It Work Internally?
Every runbook in this chapter follows the standard **PAGER Incident Response Protocol**:
1. **P - Page Received**: Alert fires with runbook URL linked in Alertmanager notification.
2. **A - Acknowledge & Assess**: Acknowledge alert in PagerDuty; determine customer impact severity (P1/P2/P3).
3. **G - Gather Telemetry**: Execute read-only diagnostic commands to verify the root cause.
4. **E - Execute Mitigation**: Apply temporary stabilizing mitigation (scale pods, shed load, rollback release).
5. **R - Resolve & Review**: Confirm metrics return to baseline; schedule blameless post-mortem.

---

## 5. Where Does It Fit in Our Architecture?
These runbooks govern live operations across our entire local and cloud architecture:
- Docker Compose & Kubernetes workloads
- PostgreSQL, Redis, and RabbitMQ stateful engines
- Ingress-NGINX and API Gateway ingress routes

---

## 6. How We Implemented It in This Project
Below are four core enterprise incident runbooks with exact commands:

---

### RUNBOOK 01: High HTTP 5xx Error Rate Spike on API Gateway

#### Severity: P1 (Critical - Customer Checkout Blocked)
#### Trigger: Prometheus alert `HighHttpErrorRate5xx` firing for > 2 minutes.

#### Step 1: Immediate Assessment (2 Minutes)
Identify which upstream microservice is returning 5xx status codes:
```powershell
# Query API Gateway error log distribution by upstream route
docker compose logs api-gateway --since=5m | Select-String "500" | Select-Object -First 10
# Or on Kubernetes:
kubectl logs -n production -l app=api-gateway --since=5m | grep '"status":5'
```

#### Step 2: Isolation & Health Probe Check
Check health probe status of all backend microservices:
```powershell
# Verify which backend service has failed healthcheck
docker compose ps
# In Kubernetes:
kubectl get pods -n production -o wide
```

#### Step 3: Immediate Mitigation
- If errors started immediately following a recent deployment:
  ```powershell
  kubectl rollout undo deployment/<failing-service> -n production
  ```
- If errors are caused by sudden traffic volume exceeding capacity:
  ```powershell
  kubectl scale deployment/<failing-service> --replicas=8 -n production
  ```

---

### RUNBOOK 02: PostgreSQL Connection Pool Exhaustion

#### Severity: P1
#### Trigger: Application logs report: `remaining connection slots are reserved for non-superuser connections` or `timeout exceeded when connecting to database`.

#### Step 1: Inspect Active Database Connections
Connect to PostgreSQL container and inspect queries holding connections:
```sql
SELECT pid, usename, client_addr, state, age(clock_timestamp(), query_start) AS duration, query
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY duration DESC;
```

#### Step 2: Kill Idle or Long-Running Blocking Queries
Identify any zombie or locking query holding a transaction open for more than 60 seconds:
```sql
-- Terminate specific rogue PID
SELECT pg_terminate_backend(<blocking_pid>);

-- Terminate all idle-in-transaction connections older than 5 minutes
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle in transaction' AND age(clock_timestamp(), query_start) > interval '5 minutes';
```

#### Step 3: Temporary Pool Mitigation
Temporarily increase max connections in `postgresql.conf` or restart the offending microservice connection pool:
```powershell
kubectl rollout restart deployment/order-service -n production
```

---

### RUNBOOK 03: RabbitMQ Message Queue Backlog Surging

#### Severity: P2 (Major - Asynchronous Processing Delayed)
#### Trigger: Prometheus alert `RabbitMQQueueBacklogHigh` (Messages unacknowledged > 1,000).

#### Step 1: Inspect Queue Depths
```powershell
# Inspect queue message counts via rabbitmqctl
docker exec -it ecommerce-rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged consumers
```

#### Step 2: Identify Consumer Health
- If `consumers == 0`: The downstream consumer microservice (e.g. `payment-service` or `inventory-service`) has crashed or disconnected from the AMQP broker.
  ```powershell
  # Check consumer logs
  docker compose logs payment-service --tail=50
  # Restart consumer
  docker compose restart payment-service
  ```
- If `messages_unacknowledged` is high: Consumers are processing too slowly or deadlocking during transaction processing. Scale consumer pod replicas:
  ```powershell
  kubectl scale deployment/payment-service --replicas=6 -n production
  ```

---

### RUNBOOK 04: Emergency Secret Leak & Refresh Token Invalidation

#### Severity: P1 (Security Breach)
#### Trigger: Suspected unauthorized token reuse or leaked JWT signing secret.

#### Step 1: Invalidate Refresh Token Families Immediately
Connect to PostgreSQL auth database and revoke all active refresh token families:
```sql
-- Immediately revoke all refresh tokens across the platform
UPDATE refresh_tokens SET is_revoked = true WHERE is_revoked = false;
```

#### Step 2: Rotate JWT Secret Key
Update the `JWT_SECRET` environment variable in the Kubernetes Secret or `.env` file:
```powershell
# Update secret with new 64-character cryptographically random secret
$NEW_SECRET = [Convert]::ToBase64String((1..64 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
kubectl create secret generic jwt-secrets --from-literal=JWT_SECRET=$NEW_SECRET --dry-run=client -o yaml | kubectl apply -f -

# Force rolling restart across all microservices to pick up new signing key
kubectl rollout restart deployment -n production
```

---

## 7. Configuration Examples
### PagerDuty Alertmanager Routing Webhook (`k8s/monitoring/alertmanager-config.yaml`):
```yaml
global:
  resolve_timeout: 5m

route:
  group_by: ['alertname', 'namespace', 'service']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'pagerduty-critical'
  routes:
  - match:
      severity: critical
    receiver: 'pagerduty-critical'
  - match:
      severity: warning
    receiver: 'slack-notifications'

receivers:
- name: 'pagerduty-critical'
  pagerduty_configs:
  - service_key: '<PAGERDUTY_INTEGRATION_KEY>'
    severity: 'critical'

- name: 'slack-notifications'
  slack_configs:
  - channel: '#devops-alerts'
    send_resolved: true
    title: '[{{ .Status | toUpper }}] {{ .CommonAnnotations.summary }}'
```

---

## 8. Commands
```powershell
# Silence an alert during planned maintenance via Alertmanager CLI
amtool silence add alertname="HighHttpErrorRate5xx" --duration="30m" --comment="Deploying database schema migration"

# Dump container memory heap before emergency restart
docker exec -it ecommerce-order-service node -e 'v8.writeHeapSnapshot("/tmp/crash.heapsnapshot")'

# Force drain a malfunctioning Kubernetes worker node
kubectl drain <node-name> --delete-emptydir-data --ignore-daemonsets --force
```

---

## 9. Verification
1. Run quarterly Game Day / Chaos Engineering simulation:
   - Introduce deliberate network latency or process crashes using Chaos Mesh.
   - Assign on-call engineer to resolve incident following only the documented runbooks.
   - Measure time-to-mitigation and verify all steps worked accurately without requiring unwritten assumptions.

---

## 10. Common Mistakes
1. **Rebooting Database While Write-Ahead Logs (WAL) are Flushing**: Running `reboot -f` on a database node during write saturation can corrupt table pages and require hours of recovery. Always issue clean database stop signals (`systemctl stop postgresql`).
2. **Executing Non-Idempotent Fixes**: Running a script twice that accidentally deletes or duplicates customer records. Runbooks must always provide idempotent commands.
3. **Failing to Notify Stakeholders**: Focusing 100% on technical debugging while leaving executive stakeholders, customer support, and users in the dark. Always post regular status updates on the internal status page every 15 minutes during P1 incidents.

---

## 11. Troubleshooting
- **Runbook Script Fails with Permission Denied**: Ensure service accounts and operators have pre-configured RBAC roles allowing debug and rollback operations without requiring manual escalation during an emergency.

---

## 12. Security Best Practices
- **Strict Role-Based Access for Production Operations**: Do not share generic administrative credentials. Use temporary session tokens generated via AWS IAM Identity Center or Teleport with full session recording.
- **Audit Logging of All Runbook Executions**: Store all commands executed during production incidents in immutable CloudTrail / Kubernetes audit logs for post-incident review.

---

## 13. Real-World Use Cases
- **Knight Capital Financial Meltdown (2012)**: A lack of runbook verification and manual deployment error caused defective code to execute millions of automated buy/sell orders in 45 minutes, bankrupting the firm with a $440 million loss. Rigorous automated deployment runbooks prevent such catastrophic outcomes.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: What is the primary difference between Incident Mitigation and Root Cause Remediation?
**Answer**:
- **Mitigation (Immediate Goal)**: Restoring service availability and customer experience as rapidly as possible, even through temporary measures (e.g. rolling back a release, scaling pod replicas, restarting a leaking worker node, shedding non-essential background traffic, or enabling feature flags). The priority is stopping customer bleeding.
- **Root Cause Remediation (Long-Term Goal)**: Diagnosing and permanently fixing the underlying bug or architectural flaw (e.g., refactoring code to eliminate a memory leak, adding a missing database index, implementing circuit breakers). This occurs *after* the incident is resolved, during normal business hours via blameless post-mortems and pull requests.

### Q2: What is the purpose of a Blameless Post-Mortem in modern SRE culture?
**Answer**: A blameless post-mortem operates on the foundational assumption that engineers do not show up to work to deliberately break production. If an engineer made an error (like executing an unparameterized script), the failure lies in the system, processes, and safeguards (lack of verification gates, lack of rollback automation, missing confirmation prompts). Blameless post-mortems uncover the systemic vulnerabilities that allowed the incident to occur and create concrete, prioritized engineering action items (preventative controls, alarms, automated tests) to ensure the failure mode can never repeat.

### Q3: When should an SRE declare a P1 incident and spin up an incident command bridge?
**Answer**: A P1 incident should be declared immediately when core business capabilities (e.g. customer authentication, product purchasing, payment settlement) are completely unavailable or experiencing error rates/latencies that violate primary Service Level Objectives (SLOs) across a significant percentage of users. The engineer who identifies the issue declares the P1, becomes the initial Incident Commander (IC), opens a dedicated bridge (video call / Slack war-room), assigns roles (Communications Lead, Operations Lead), silences alert noise, and coordinates systematic triage until service is restored.
