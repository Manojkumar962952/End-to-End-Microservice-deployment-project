# Enterprise Distributed Systems & System Design Guide

This document explains the core distributed system patterns, concepts, and trade-offs that govern this enterprise platform. Every technical decision in this platform is backed by these principles.

---

## 1. Monolithic vs. Microservices Architecture

### The Monolith
A monolithic application packages all business domains (Users, Products, Orders, Payments, Notifications) into a single deployable artifact running against a single shared database.

- **Advantages**:
  - Trivial local setup: run one server process and one database.
  - Zero distributed network overhead: function calls in memory take nanoseconds.
  - ACID transactions: simple `BEGIN TRANSACTION ... COMMIT` guarantees consistency across tables.
  - Simple refactoring: compile-time type safety across domains.
- **Disadvantages as Scale Increases**:
  - **Shared Blast Radius**: A memory leak or unhandled exception in the notification worker crashes the entire web server, taking down checkout.
  - **Scaling Inefficiency**: To scale the CPU-intensive image resizing in the product catalog, you must replicate the entire monolith, including memory-hungry order modules.
  - **Team Contention**: 50+ developers committing to one codebase create merge conflicts, deployment train bottlenecks, and organizational friction.
  - **Database Bottlenecks**: A single database handles all writes, leading to connection exhaustion and complex indexing compromises.

### The Microservice
A microservices architecture decomposes the application into small, independently deployable services organized around business capabilities. Each service runs in its own process and owns its private data storage.

- **When Are Microservices Actually Required?**
  1. Multiple independent engineering squads need to deploy changes multiple times per day without coordinating releases.
  2. Subsystems have radically different scaling characteristics (e.g. read-heavy product catalog vs. write-contended inventory vs. async background notifications).
  3. Strict fault isolation is required: a failure in third-party notification delivery must not halt financial checkout.
- **The Hidden Cost**:
  - Network latency between services.
  - Distributed data consistency (no cross-service ACID transactions).
  - High operational complexity: needs Docker, Kubernetes, CI/CD, centralized logging, and distributed tracing.

---

## 2. Communication Protocols: Synchronous vs. Asynchronous

### Synchronous Communication (REST / gRPC)
- The caller sends a request and **blocks or awaits** until the receiver returns a response.
- **When to use**: When the client strictly requires the return payload to continue (e.g., User Login returns JWT, Product search returns item list).
- **Failure Mode - Cascading Failures**: If Service A calls Service B, which calls Service C, and Service C hangs:
  - Service B exhausts its thread pool waiting for C.
  - Service A exhausts its thread pool waiting for B.
  - The API Gateway runs out of sockets. The entire system freezes.

### Asynchronous Communication (AMQP / RabbitMQ)
- The sender publishes a message or event to an intermediary message broker and returns immediately. One or more consumers process the message independently.
- **When to use**: Transactional workflows, notifications, analytics, long-running processes, and cross-domain state synchronization.
- **Benefits**:
  - **Temporal Decoupling**: If the Notification Service is down for 10 minutes during a deployment, messages queue up safely in RabbitMQ and process once it restarts. Zero lost orders or notifications.
  - **Traffic Buffering (Load Leveling)**: During a flash sale with 10,000 orders/minute, the payment and inventory workers consume messages at a steady, sustainable rate, protecting downstream systems from crashing.

---

## 3. API Gateway vs. Load Balancer vs. Ingress Controller

Many engineers confuse these three components. Here is how they differ in enterprise architecture:

| Component | Layer | Primary Responsibility | Example |
| :--- | :--- | :--- | :--- |
| **Network Load Balancer (NLB)** | Layer 4 (Transport) | Ultra-fast routing of raw TCP/UDP packets based on IP address and port. Does not inspect HTTP headers or payload. | AWS NLB, HAProxy TCP mode |
| **Application Load Balancer (ALB)** | Layer 7 (Application) | Inspects HTTP/HTTPS headers, paths, hostnames, and cookies to distribute traffic across target compute groups. Handles SSL/TLS termination. | AWS ALB, NGINX |
| **Kubernetes Ingress Controller** | Layer 7 (In-cluster) | A specialized reverse proxy (often Envoy or NGINX) running inside Kubernetes, configured dynamically by Ingress YAML resources to route traffic to Pod Services. | Ingress-NGINX, AWS Load Balancer Controller |
| **API Gateway** | Layer 7 (Application / Business) | High-level API management: JWT authentication, rate limiting, request transformation, API key validation, schema validation, correlation ID generation, and route composition. | Express/Kong/Traefik API Gateway |

In our enterprise architecture:
$$\text{Customer} \xrightarrow{\text{HTTPS}} \text{AWS ALB / Ingress} \xrightarrow{\text{HTTP}} \text{API Gateway} \xrightarrow{\text{Internal REST}} \text{Microservice Pods}$$

---

## 4. Database Ownership & Database-Per-Service Pattern

### The Anti-Pattern: Shared Database
Allowing Microservice A to write directly to Microservice B's SQL database completely breaks encapsulation:
- If Service B changes a column name, Service A breaks unexpectedly.
- Service A might bypass Service B's business validation rules.
- Deadlocks occur when two different codebases lock rows in unpredictable sequences.

### The Enterprise Pattern: Database per Service
Each microservice has its own private database or logically isolated schema.
- **Rule**: Only the service that owns the database is permitted to read or write to it.
- **How other services access data**: They must call the owner service's public API or subscribe to its domain events.
- **Example in our platform**:
  - `Order Service` owns `order_db`.
  - `Order Service` **cannot** query `inventory_db` to check stock. It sends an event or calls `GET /api/v1/inventory/:productId`.

---

## 5. Distributed Transactions: The Saga Pattern

When a business transaction spans multiple microservices, you cannot use a single SQL transaction.

### Why Not Two-Phase Commit (2PC)?
Two-Phase Commit coordinates a distributed lock across all participating databases until all agree to commit.
- In distributed cloud environments, network partitions and slow participants cause lock contention across databases, degrading throughput by 10x to 100x and risking distributed deadlocks.

### The Saga Pattern
A Saga is a sequence of local transactions. Each transaction updates data within a single service and publishes a domain event.
- If a step fails, the Saga executes **Compensating Transactions** that undo the changes made by earlier steps.

### Choreography vs. Orchestration
1. **Choreography (Used in our platform)**:
   - Services listen to domain events from a broker (RabbitMQ) and decide their next action without a central coordinator.
   - *Advantage*: High decoupling, zero single coordinator bottleneck.
2. **Orchestration**:
   - A dedicated orchestrator service sends explicit commands to each participant ("Reserve Stock", "Charge Card") and evaluates responses.

---

## 6. Resilience Patterns: Protecting Against Distributed Failure

### 6.1 Idempotency
An operation is **idempotent** if applying it multiple times produces the exact same outcome as applying it once:
$$f(f(x)) = f(x)$$
- *Why is it required?* If a network timeout occurs while the client is paying for an order, the client will retry. If the payment service is not idempotent, the user is charged twice!
- *Implementation*: Every mutating request requires an `Idempotency-Key` header. The service stores the key in Redis/DB with the processed result. If a duplicate arrives, the stored response is returned immediately.

### 6.2 Timeouts
Every network call must have a strict timeout (e.g., 2000 ms). If a downstream service does not answer within the timeout, the calling service cancels the socket, preventing thread pool exhaustion.

### 6.3 Retries with Exponential Backoff and Jitter
Blindly retrying failed requests immediately can cause a **thundering herd** that knocks over an already struggling service.
- **Formula**:
  $$t_{\text{wait}} = \min(t_{\text{max}}, t_{\text{base}} \times 2^{\text{attempt}}) \pm \text{jitter}$$
- Jitter adds small random delays so 1,000 retrying clients don't strike the server at the exact same millisecond.

### 6.4 Circuit Breaker Pattern
Monitors the failure rate of downstream calls. If failures exceed a threshold (e.g., 50% errors over 10 seconds), the breaker **trips open**:
- **Closed**: Normal traffic flows through.
- **Open**: Inbound requests immediately fail fast with a fallback or cached response without making network calls.
- **Half-Open**: Periodically allows a small probe request through. If it succeeds, the breaker closes.

### 6.5 Rate Limiting
Protects backend services from abusive traffic, DDoS attacks, or runaway client loops.
- Implemented at the API Gateway using the **Redis Token Bucket algorithm** (e.g., 100 requests per minute per IP address).

---

## 7. Stateless Application Design & Horizontal Scaling

To scale horizontally (adding more Pod replicas):
- **Rule**: Containers must be completely **stateless**.
- No session data stored in container memory or local filesystem.
- All sessions are verified via cryptographic JWTs or stored in shared, distributed Redis clusters.
- Any replica of a service can handle any incoming request.
- Container restarts, kills, and migrations cause zero user data loss.
