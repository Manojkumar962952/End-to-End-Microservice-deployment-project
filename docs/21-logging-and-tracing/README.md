# Chapter 21: Centralized Logging, OpenTelemetry & Distributed Tracing

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                               DISTRIBUTED TRACING & LOGGING ARCHITECTURE                  |
+───────────────────────────────────────────────────────────────────────────────────────────+
| [Client Browser: POST /api/v1/orders]                                                     |
|         │                                                                                 |
|         ▼ (x-correlation-id: 7f8a9b2c-1234, traceparent: 00-4bf92f3577b34da6-00f067aa-01) |
| [API Gateway: Port 8000] ───(JSON Log: stdout)───> [FluentBit DaemonSet]                 |
|         │                                                                                 |
|         ▼ (Propagate Headers via HTTP / AMQP)                                            |
| [Order Service: Port 5004] ─(JSON Log: stdout)───> [FluentBit DaemonSet]                 |
|         │                                                    │                            |
|         ├── RabbitMQ (Event: order.created with Trace Context)│                            |
|         │                                                    ▼                            |
|         ▼                                            [Grafana Loki]                       |
| [Inventory Service: Port 5006] (JSON Log: stdout)    (Indexed by: service, level,         |
|         │                                             correlation_id)                     |
|         ▼ (OTel Span Export: gRPC 4317)                      │                            |
| [OpenTelemetry Collector]                                    ▼                            |
|         │                                            [Grafana Dashboard]                  |
|         ▼                                            • Correlate Trace ID ────────┐       |
| [Jaeger / Tempo Tracing Backend]                                                  │       |
| └─ Unified Trace View: Gateway (15ms) -> Order (40ms) -> Inventory (25ms) <───────┘       |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
Centralized Logging and Distributed Tracing constitute the forensic pillars of microservices observability.
- **Structured Centralized Logging**: Microservices emit machine-readable JSON logs to standard output (`stdout`), which are aggregated by log collectors (FluentBit / Vector) and indexed into high-performance search clusters (Grafana Loki / OpenSearch).
- **OpenTelemetry Distributed Tracing**: Follows the path of an individual user request as it traverses asynchronous boundaries (HTTP requests, database calls, RabbitMQ message queues), providing microsecond-level latency waterfalls and bottleneck identification.

---

## 2. Why Do Companies Use It?
- **Finding the Needle in the Haystack**: In an architecture with 8 microservices and dozens of Pod replicas, reproducing a single failed checkout across scattered log files is impossible without distributed tracing and correlation IDs.
- **Asynchronous Bottleneck Identification**: Pinpoints whether an order delay is caused by database row-locking contention, slow third-party payment gateway HTTP calls, or RabbitMQ queue starvation.
- **Cost Reduction via Index-Free Logging (Loki)**: Unlike traditional Elasticsearch/OpenSearch clusters that index full message text (inflating storage costs by 10x), Grafana Loki only indexes metadata labels (like `service`, `namespace`, `level`), compressing log chunks into cheap S3 object storage.

---

## 3. What Problem Does It Solve?
- **Unstructured Log Chaos**: Prevents developers from writing chaotic unstructured `console.log("here")` strings. Enforces JSON schemas with timestamps, levels, service names, and correlation IDs.
- **Context Loss across Async Message Queues**: W3C `traceparent` headers bridge synchronous HTTP REST requests with asynchronous RabbitMQ message consumers.
- **Local Disk Exhaustion**: Containers writing logs to disk fill node storage. Logging to `stdout` allows container engines to rotate log files and collectors to ship them off-node.

---

## 4. How Does It Work Internally?
1. **W3C Trace Context Propagation**:
   - Every request is tagged with a `traceparent` header: `version-trace_id-parent_span_id-trace_flags` (e.g., `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`).
   - Downstream services extract this header and create child spans, linking all calls into a single unified trace tree.
2. **Log Collection DaemonSet (FluentBit)**:
   - Runs on every Kubernetes node, reading container log files from `/var/log/pods/*/*.log`.
   - Parses JSON payloads, extracts Kubernetes metadata (pod name, namespace), and ships compressed streams to Grafana Loki via HTTP API.
3. **LogQL & Trace-to-Log Correlation**:
   - In Grafana, clicking on a specific Jaeger/Tempo trace span automatically queries Loki for logs with that matching `trace_id` or `correlation_id`.

---

## 5. Where Does It Fit in Our Architecture?
- **Shared Logger Library (`shared/logger`)**: Standardized structured JSON logger based on Winston/Pino.
- **Correlation ID Middleware (`shared/middleware`)**: Automatically injects or extracts `x-correlation-id` and attaches it to request scopes and log contexts.
- **Log Aggregator**: FluentBit collecting container logs.
- **Storage & Visualization**: Grafana Loki for log storage; Grafana Tempo for OpenTelemetry trace visualization.

---

## 6. How We Implemented It in This Project
### Correlation ID and Structured Logger Integration:

```typescript
// shared/logger/src/index.ts
export interface LogContext {
  correlationId?: string;
  userId?: string;
  service: string;
  [key: string]: unknown;
}

export class Logger {
  constructor(private serviceName: string) {}

  info(message: string, context?: LogContext) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'INFO',
      service: this.serviceName,
      message,
      ...context
    }));
  }

  error(message: string, error?: Error, context?: LogContext) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      service: this.serviceName,
      message,
      error: error ? { message: error.message, stack: error.stack } : undefined,
      ...context
    }));
  }
}
```

---

## 7. Configuration Examples
### FluentBit Kubernetes ConfigMap Snippet
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: fluent-bit-config
  namespace: logging
data:
  fluent-bit.conf: |
    [SERVICE]
        Flush         1
        Log_Level     info
        Parsers_File  parsers.conf

    [INPUT]
        Name              tail
        Tag               kube.*
        Path              /var/log/pods/production_*/*/*.log
        Parser            docker
        Mem_Buf_Limit     50MB

    [OUTPUT]
        Name          loki
        Match         kube.*
        Host          loki.logging.svc.cluster.local
        Port          3100
        Labels        job=fluentbit
        Label_Keys    $kubernetes['container_name'], $kubernetes['namespace_name']
```

---

## 8. Commands
```powershell
# Query logs in real time from Grafana Loki using LogCLI
logcli query '{namespace="production", container="order-service"} |= "ERROR"' --tail

# Query logs matching a specific correlation ID across ALL microservices
logcli query '{namespace="production"} |= "7f8a9b2c-1234"'

# Stream OpenTelemetry collector health and metrics
kubectl logs -f -n monitoring -l app=opentelemetry-collector
```

---

## 9. Verification
1. Execute an order checkout via the UI or `scripts/verify-local.ps1`.
2. Grab the returned `x-correlation-id` header from the response envelope.
3. Search for that correlation ID in Grafana Loki.
4. Verify that log entries from `api-gateway`, `order-service`, `inventory-service`, and `payment-service` all appear in chronological sequence under that single correlation ID.

---

## 10. Common Mistakes
1. **Logging Sensitive Data (PII / Secrets)**: Logging plain text passwords, credit card PANs, or JWT tokens. Always implement redaction masks in your logger for keys like `password`, `cardNumber`, `cvv`, `authorization`.
2. **Writing Logs to Local Disk Files inside Containers**: Files written inside container filesystems consume RAM/overlay storage and are destroyed when the Pod restarts. Always write to `stdout`/`stderr`.
3. **Losing Trace Context in Async Background Queues**: Forgetting to attach `traceparent` headers to AMQP message properties when publishing to RabbitMQ, breaking the trace graph.

---

## 11. Troubleshooting
- **FluentBit Dropping Logs / High Memory (`Buffer Full`)**: When an application outputs 50,000 logs/second during an error loop, FluentBit buffers fill up. Configure disk buffering (`storage.type filesystem`) and increase `Mem_Buf_Limit`.
- **Loki Ingestion Rate Limit Exceeded (`429 Too Many Requests`)**: Increase `ingestion_rate_mb` and `max_streams_per_user` in Loki's limits configuration.

---

## 12. Security Best Practices
- **Automated PII Masking**: Implement regex sanitizer interceptors in the logger shared library to replace sensitive patterns with `[REDACTED]`.
- **Log Immutability**: Configure S3 Object Lock (WORM - Write Once, Read Many) on the underlying Loki storage bucket to ensure logs cannot be tampered with or deleted by an attacker during an audit.

---

## 13. Real-World Use Cases
- **Payment Reconciliation & Fraud Investigation**: When a customer disputes a transaction, support engineers look up the order ID, find the correlation ID, and view the millisecond-accurate trace across Gateway, Fraud Service, and Stripe API to confirm settlement.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: What is the difference between a Trace, a Span, and a Log in OpenTelemetry?
**Answer**:
- **Log**: An isolated, timestamped text or JSON event emitted by a single process describing what occurred at a specific point in time (e.g. "Database connection established").
- **Span**: A single contiguous unit of work or segment within a distributed request. It contains a name, start timestamp, end timestamp, status code, and attributes (e.g., executing `SELECT * FROM inventory WHERE product_id = $1` taking 14ms).
- **Trace**: A Directed Acyclic Graph (DAG) composed of multiple Spans sharing the same `trace_id`. It represents the end-to-end journey of a request as it moves through various microservices, networks, and asynchronous queues.

### Q2: Why is Grafana Loki significantly cheaper to operate than an Elasticsearch / OpenSearch cluster?
**Answer**: Elasticsearch indexes every text word and token in log messages into complex inverted indexes, requiring massive CPU, fast NVMe SSDs, and huge RAM heaps (often 50% of memory). Grafana Loki borrows its philosophy from Prometheus: it does **not** index the log text itself. Instead, it indexes only the metadata key-value labels (e.g., `service="order-service"`, `environment="prod"`). The actual raw log content is compressed into immutable gzip chunks and saved directly to ultra-cheap cloud object storage (Amazon S3), reducing infrastructure costs by up to 80%.

### Q3: How do you propagate distributed trace contexts across asynchronous message brokers like RabbitMQ or Kafka?
**Answer**: Unlike synchronous HTTP where headers are transmitted in HTTP request headers (`traceparent`), message brokers utilize **AMQP Message Properties / Kafka Record Headers**. When a microservice (e.g., `order-service`) publishes an event, the OpenTelemetry SDK injects the current active trace context (`traceparent`, `tracestate`) into the message headers map. When the consumer (`inventory-service` or `payment-service`) dequeues the message, it extracts those headers, creates a child span with `links` pointing to the parent trace, and resumes the trace uninterrupted.
