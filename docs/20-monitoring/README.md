# Chapter 20: Enterprise Observability: Prometheus, Grafana & SRE Golden Signals

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                               ENTERPRISE OBSERVABILITY & METRICS PIPELINE                 |
+───────────────────────────────────────────────────────────────────────────────────────────+
| [8 Microservices & Gateway] ──> Expose `/metrics` (Prometheus Client TS / OpenTelemetry)   |
|                                        │ (HTTP GET Scrape every 15s)                      |
|                                        ▼                                                  |
| [Prometheus Server / Thanos HA in Kubernetes]                                             |
| ┌───────────────────────────────────────────────────────────────────────────────────────┐ |
| │ • Time-Series Database (TSDB): In-Memory Head Block + 2-Hour WAL Compaction           │ |
| │ • ServiceMonitor Custom Resources (Prometheus Operator Auto-Discovery)                │ |
| │ • Recording Rules & Prometheus Alerting Rules                                         │ |
| └───────────────────────────────────────────────────────────────────────────────────────┘ |
|         │                                                 │                               |
|         ▼ (Alert Triggered)                               ▼ (PromQL Dashboard Queries)    |
| [Alertmanager]                                    [Grafana Enterprise Dashboards]         |
| ├── PagerDuty (P1 / Critical Incidents)           ├── 4 Golden Signals Dashboard          |
| ├── Slack / Microsoft Teams (#devops-alerts)      ├── Microservice RED Metrics            |
| └── Grouping, Inhibitions, & Silencing            └── JVM / Node.js Event Loop Latency    |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
Enterprise Observability is the capability to infer the internal health, performance state, and bottlenecks of a distributed microservices system based on its external telemetry outputs. It relies on **Prometheus** (a high-performance time-series database and pull-based metrics scraper) and **Grafana** (a multi-source data visualization and dashboarding platform), anchored around the **Google SRE 4 Golden Signals**: Latency, Traffic, Errors, and Saturation.

---

## 2. Why Do Companies Use It?
- **Rapid Mean Time to Detect (MTTD) & Recover (MTTR)**: Detects production anomalies within seconds rather than waiting for customers to report broken checkouts on social media.
- **Service Level Objectives (SLOs) & Error Budgets**: Quantifies reliability (e.g. 99.95% of `/orders` requests succeed under 200ms) to make data-driven decisions on release velocity vs. stabilization.
- **Capacity Planning**: Predicts CPU, memory, and database connection pool exhaustion weeks before flash sales occur.

---

## 3. What Problem Does It Solve?
- **Alert Fatigue**: Alertmanager groups hundreds of firing alerts during a network partition into a single grouped incident notification, preventing engineers from being spammed.
- **Hidden Latency Spikes (The p99 Problem)**: Average latency hides catastrophic degradation for the slowest 1% of customers. Prometheus percentiles (`histogram_quantile(0.99, ...)`) expose real edge latency.
- **Cascading Failures**: Identifies which upstream microservice caused downstream connection starvation across database connection pools.

---

## 4. How Does It Work Internally?
1. **Pull-Based Metrics Scraping**:
   - Every 15 seconds, Prometheus sends HTTP GET requests to `/metrics` endpoints discovered dynamically via Kubernetes `ServiceMonitor` CRDs.
2. **Prometheus TSDB**:
   - Writes incoming time-series samples (timestamp + float64) to an in-memory head chunk, protected by an append-only Write-Ahead Log (WAL).
   - Every 2 hours, head chunks are compacted into immutable two-hour blocks on disk.
3. **Alert Evaluation Loop**:
   - Prometheus evaluates PromQL alerting expressions periodically (e.g., every 30s). When conditions are met for longer than `for: 5m`, an alert transition from `Pending` to `Firing` and is dispatched to Alertmanager.

---

## 5. Where Does It Fit in Our Architecture?
- **Application Instrumentation**: All 8 backend services use `prom-client` to expose RED metrics (Rate, Errors, Duration).
- **Cluster Monitoring**: Prometheus Operator (`kube-prometheus-stack`) deployed in `monitoring` namespace.
- **Dashboards**: Grafana pre-loaded with dashboards for the 4 Golden Signals, Kubernetes Node resources, PostgreSQL metrics, and RabbitMQ queue depths.

---

## 6. How We Implemented It in This Project
### 1. Prometheus Metrics Middleware in Shared Library (`shared/middleware/src/metrics.ts`):
```typescript
import client from 'prom-client';
import { Request, Response, NextFunction } from 'express';

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
});

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime();
  res.on('finish', () => {
    const [seconds, nanoseconds] = process.hrtime(start);
    const duration = seconds + nanoseconds / 1e9;
    httpRequestDuration.labels(req.method, req.route?.path || req.path, res.statusCode.toString()).observe(duration);
  });
  next();
};
```

---

## 7. Configuration Examples
### Production SRE Alerting Rules (`k8s/monitoring/prometheus-rules.yaml`):

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: ecommerce-sre-alerts
  namespace: monitoring
spec:
  groups:
  - name: golden-signals.rules
    rules:
    # 1. High HTTP Error Rate Alert
    - alert: HighHttpErrorRate5xx
      expr: |
        sum(rate(http_request_duration_seconds_count{status_code=~"5.."}[5m]))
        /
        sum(rate(http_request_duration_seconds_count[5m])) * 100 > 1.0
      for: 2m
      labels:
        severity: critical
        team: sre
      annotations:
        summary: "High HTTP 5xx error rate detected on {{ $labels.service }}"
        description: "5xx error rate is {{ $value | printf \"%.2f\" }}% over the last 5 minutes (SLO breached)."

    # 2. High p99 Latency Alert
    - alert: ApiHighP99Latency
      expr: |
        histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route)) > 0.5
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "p99 latency for {{ $labels.route }} exceeds 500ms"
```

---

## 8. Commands
```powershell
# Port-forward Prometheus UI locally
kubectl port-forward svc/prometheus-k8s 9090:9090 -n monitoring

# Port-forward Grafana UI locally (admin/prom-operator)
kubectl port-forward svc/grafana 3001:80 -n monitoring

# Execute instant PromQL query via Prometheus HTTP API
curl "http://localhost:9090/api/v1/query?query=sum(rate(http_request_duration_seconds_count[5m]))"
```

---

## 9. Verification
1. Generate test traffic: Run `scripts/verify-local.ps1`.
2. Open Prometheus UI (`http://localhost:9090`), search for `http_request_duration_seconds_count`.
3. Verify graphs display live request counts tagged with route labels (`/api/v1/orders`).
4. Trigger intentional 500 errors; verify that `HighHttpErrorRate5xx` transitions from `Pending` $\rightarrow$ `Firing`.

---

## 10. Common Mistakes
1. **High-Cardinality Metric Labels**: Adding unique IDs (such as `user_id`, `order_id`, or timestamps) as Prometheus metric labels. This creates millions of unique time series, exhausting Prometheus memory and crashing the server. Use OpenTelemetry traces for unique IDs, and metrics for aggregated bounded categories.
2. **Monitoring Averages instead of Percentiles**: An average response time of 100ms can hide the fact that 5% of users are experiencing 10-second timeouts. Always measure p95 and p99 percentiles using Histograms.
3. **Alerting on Symptoms rather than User Impact**: Paging an on-call engineer at 3 AM because a single CPU core spiked to 90%, even though user error rates and latencies are completely normal. Alert on user-facing SLOs first.

---

## 11. Troubleshooting
- **Prometheus Target Down (`TargetDown`)**: Prometheus cannot reach the Pod's `/metrics` endpoint. Check if the Pod is healthy and that NetworkPolicies allow ingress from Prometheus on port 5000–8000.
- **Prometheus Out of Memory Crash (`OOMKilled`)**: Caused by high cardinality. Identify problematic metrics using the Prometheus TSDB Status UI (`/tsdb-status`) to find top series count churn.

---

## 12. Security Best Practices
- **Never Expose Prometheus / Grafana to Public Internet**: Restrict monitoring access to internal VPN or AWS IAM Identity Center (SSO).
- **Encrypt Telemetry in Transit**: Enforce TLS between Prometheus scrapers and microservices.
- **Scrub PII from Metric Labels**: Ensure customer email addresses or credit card numbers are never placed into metric label strings.

---

## 13. Real-World Use Cases
- **Dynamic Autoscaling on Business Metrics**: Autoscaling inventory and order pods during sales events based on custom Prometheus metrics (e.g. `rabbitmq_queue_messages_ready > 500`) via KEDA (Kubernetes Event-driven Autoscaling).

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: What are Google's 4 Golden Signals of SRE and how do they differ from the RED method?
**Answer**:
- **Google's 4 Golden Signals**:
  1. **Latency**: Time taken to service a request (distinguishing between successful and failed requests).
  2. **Traffic**: Demand on the system (e.g., HTTP requests/sec or network I/O).
  3. **Errors**: Rate of requests that fail (explicit 5xx errors or implicit wrong content).
  4. **Saturation**: How full the service's constrained resources are (CPU, memory, connection pools).
- **The RED Method** (popularized by Tom Wilkie): A subset tailored for microservices focusing on **Rate** (requests/sec), **Errors** (failed requests/sec), and **Duration** (latency distribution). The 4 Golden Signals encompass RED while adding Saturation.

### Q2: Why is pull-based metrics collection (Prometheus) preferred over push-based (StatsD / CloudWatch) in Kubernetes?
**Answer**:
1. **Health Detection (Decoupled Liveness)**: If a target dies, Prometheus immediately marks it as `DOWN` (`up == 0`). In push-based systems, silence from a target could mean it crashed OR that it has no traffic.
2. **Load Protection**: Under massive flash-sale traffic, microservices pushing metrics can flood monitoring backends or exhaust network sockets. In a pull model, the scrape rate is controlled by the monitoring server (e.g., once every 15s), preventing metric thundering herds.
3. **Dynamic Discovery**: Pull architecture integrates naturally with the Kubernetes API to discover Pods dynamically as they scale up and down.

### Q3: Why does `histogram_quantile(0.99, ...)` require `rate()` in PromQL?
**Answer**: Prometheus histogram buckets (`_bucket`) are cumulative counters representing the total number of observations falling into each bucket since process startup. To calculate the 99th percentile over a recent moving window (e.g., the last 5 minutes), you must first compute the per-second rate of increase of each bucket using `rate(...[5m])`. Passing raw counters to `histogram_quantile()` would calculate percentiles across the entire lifetime of the process, completely masking recent latency spikes.
