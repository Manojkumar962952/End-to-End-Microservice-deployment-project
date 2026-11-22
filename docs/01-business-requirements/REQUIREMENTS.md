# Business and System Requirements Specification

## 1. Executive Summary
This document establishes the functional, non-functional, domain boundary, and operational requirements for the **Enterprise E-Commerce and Order Management Platform**. The platform is designed as an enterprise-grade, distributed microservices system simulating real-world e-commerce operations, resilient checkout processing, and production-standard DevOps infrastructure.

---

## 2. Business Stakeholders & Personas

### 2.1 Customer (End User)
- **Goal**: Browse product catalog, filter by categories, check real-time availability, add items to cart, securely checkout, track order status, and review order history.
- **Pain Point to Avoid**: Stale inventory leading to canceled orders after payment, slow checkout response times, duplicate credit card charges on network hiccup.

### 2.2 Store Administrator
- **Goal**: Manage product catalog (create, update, archive products), adjust physical warehouse inventory counts, view orders, and inspect transaction statuses.

### 2.3 DevOps & SRE Team
- **Goal**: Operate high-availability services, achieve zero-downtime deployments, monitor system health via 4 golden signals, prevent cascading failures, and ensure rapid mean-time-to-recovery (MTTR).

---

## 3. Functional Requirements by Bounded Context

### FR-1: Authentication & Access Control
1. **Registration**: Customers register using email and password. Passwords must be hashed using **Argon2id**.
2. **Login & Session Management**:
   - Issue short-lived JSON Web Tokens (JWT) (15-minute TTL) for API authentication.
   - Issue long-lived Refresh Tokens (7-day TTL) for seamless token renewal.
   - Implement Refresh Token Rotation (RTR): once a refresh token is used, it is invalidated and replaced; reuse indicates potential theft and revokes the entire token family.
3. **Role-Based Access Control (RBAC)**: Support roles: `CUSTOMER`, `ADMIN`, `SERVICE`.
4. **Token Revocation**: Ability to blacklist or invalidate tokens upon explicit logout via Redis key store.

### FR-2: Customer Profile Management
1. Maintain customer profile details (first name, last name, phone number, shipping address, billing address).
2. Customer details are decoupled from authentication credentials to maintain security isolation.

### FR-3: Product Catalog & Search
1. View paginated product list with category, price range, and keyword filtering.
2. View detailed product specifications.
3. Cache frequent product catalog queries in Redis with a 10-minute TTL and cache invalidation on product update.

### FR-4: Inventory & Concurrency Management
1. Track available, reserved, and sold inventory counts.
2. Atomically reserve inventory during checkout to prevent overselling.
3. Enforce optimistic locking or row-level `SELECT ... FOR UPDATE` locks during stock reservation to prevent race conditions during concurrent checkouts.
4. Release reserved inventory if payment fails or expires within 10 minutes.

### FR-5: Order Lifecycle Management
1. Create an order with items, quantities, and snapshot prices (preventing retrospective price changes).
2. Manage state machine transitions:
   - `PENDING`: Order created, awaiting inventory reservation.
   - `RESERVED`: Inventory secured, awaiting payment confirmation.
   - `CONFIRMED`: Payment captured successfully, ready for warehouse fulfillment.
   - `FAILED`: Insufficient stock, payment rejection, or checkout timeout.
   - `CANCELLED`: User or admin canceled prior to shipment.
3. Retrieve customer order history with pagination and status filtering.

### FR-6: Payment Simulation & Idempotency
1. Provide simulated payment processing supporting outcomes: `SUCCESS`, `INSUFFICIENT_FUNDS`, `GATEWAY_TIMEOUT`, `CARD_DECLINED`.
2. **Strict Idempotency**: Require an `Idempotency-Key` HTTP header (UUID v4) on all payment attempts. If a duplicate request arrives with the same key, return the existing transaction record without charging again.

### FR-7: Asynchronous Notifications
1. Listen for domain events on RabbitMQ (`order.created`, `order.confirmed`, `order.failed`, `payment.failed`).
2. Log formatted transactional email simulations with timestamps, recipient email, correlation ID, and payload summaries.

---

## 4. Non-Functional Requirements (NFRs)

### NFR-1: Performance & Latency
- 95th percentile (P95) latency for read operations (product catalog) < **100 ms**.
- P95 latency for write operations (order placement acknowledgment) < **250 ms**.
- API Gateway overhead < **15 ms**.

### NFR-2: Availability & Resilience
- High Availability target: **99.9% uptime** (excluding planned maintenance).
- Zero single points of failure (SPOF) at the compute layer.
- Graceful degradation: If Notification Service or Redis is unavailable, core ordering must continue functioning.

### NFR-3: Security
- OWASP Top 10 compliance across all endpoints.
- All inter-service and public traffic validated against strict JSON schemas (Zod).
- No service runs as `root` inside containers.
- All secrets externalized (environment variables / Docker secrets / AWS Secrets Manager).

### NFR-4: Observability
- Every inbound request assigned a unique `x-correlation-id` at the API Gateway.
- Correlation ID propagated across HTTP headers, RabbitMQ message headers, and structured JSON logs.
- Expose `/health/live` and `/health/ready` endpoints on every microservice for container and orchestrator probes.
- Expose Prometheus `/metrics` endpoint on all backend services.
