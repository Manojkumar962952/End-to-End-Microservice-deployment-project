# Architectural Decision Log (ADR)

This log records every major architectural and technology decision, the context behind it, alternatives considered, and the rationale.

---

## ADR-001: Architecture Model – Microservices vs. Modular Monolith
- **Date**: 2026-11-22
- **Status**: Accepted
- **Context**: The platform is an enterprise-scale e-commerce and order management application. We need to demonstrate production-grade distributed systems patterns, independent deployability, fault isolation, and horizontal scalability.
- **Alternatives Considered**:
  1. *Monolithic Architecture*: Simpler deployments and zero distributed network overhead, but lacks independent scaling, fails as a single blast-radius, and does not provide real-world distributed systems learning.
  2. *Modular Monolith*: Clear internal boundaries but single runtime deployment and shared database.
  3. *Microservices Architecture*: Complete separation of concerns, independent deployments, independent database schemas, and realistic enterprise DevOps patterns.
- **Decision**: Adopt Microservices Architecture with 8 dedicated services (API Gateway, Auth, User, Product, Inventory, Order, Payment, Notification).
- **Consequences**:
  - *Positive*: Independent deployment pipelines, zero shared database locks, isolated failure domains.
  - *Trade-off*: Must handle distributed data consistency via Saga pattern, network latency, correlation tracking, and complex local orchestration.

---

## ADR-002: Service Communication – Hybrid Synchronous REST + Asynchronous AMQP (RabbitMQ)
- **Date**: 2026-11-22
- **Status**: Accepted
- **Context**: Different business operations have fundamentally different latency and consistency needs.
- **Decision**:
  - Use **Synchronous HTTP/REST** for client queries and immediate request/response interactions (e.g. login, product retrieval, order placement acknowledgement).
  - Use **Asynchronous AMQP (RabbitMQ)** for transactional workflows and domain events (e.g., `order.created`, `inventory.reserved`, `payment.succeeded`, `notification.send`).
- **Rationale**: Synchronous cascading HTTP calls across 5 services introduce high latency and tight coupling. If payment or notifications slow down, checkout would hang. Asynchronous message queuing decouples services and guarantees eventual consistency.

---

## ADR-003: Database Isolation – Database-per-Service via Dedicated Schemas
- **Date**: 2026-11-22
- **Status**: Accepted
- **Context**: Services must own their data models. Direct cross-database queries violate service boundaries and cause tight coupling.
- **Decision**:
  - In local development: A single PostgreSQL 16 container hosting completely separated logical databases/schemas (`auth_db`, `user_db`, `product_db`, `inventory_db`, `order_db`, `payment_db`, `notification_db`) with distinct database user credentials per service.
  - In AWS production: Separate RDS instances or tightly isolated Aurora databases per tier.
- **Consequences**: No service can execute SQL queries or `JOIN`s against another service's database. Cross-domain queries must occur via REST APIs or cached event projections.

---

## ADR-004: Distributed Transaction Management – Choreographed Saga Pattern
- **Date**: 2026-11-22
- **Status**: Accepted
- **Context**: The checkout flow spans Order, Inventory, and Payment services. Traditional Two-Phase Commit (2PC) distributed locks degrade throughput and create single points of failure.
- **Decision**: Implement a Choreographed Saga with compensating transactions:
  - `OrderCreated` $\rightarrow$ triggers Inventory reservation.
  - If reserved $\rightarrow$ triggers Payment processing.
  - If payment succeeds $\rightarrow$ Order marked `CONFIRMED`.
  - If payment fails $\rightarrow$ emit `PaymentFailed` $\rightarrow$ Inventory releases reserved stock $\rightarrow$ Order marked `FAILED`.
- **Consequences**: Requires careful handling of duplicate messages (idempotency keys) and eventual consistency in user UI.

---

## ADR-005: Security & Token Architecture – Short-Lived JWT + Refresh Token Rotation
- **Date**: 2026-11-22
- **Status**: Accepted
- **Context**: Need stateless API gateway authentication without querying the database for every single request, while maintaining ability to revoke stolen sessions.
- **Decision**:
  - Short-lived signed JWT Access Tokens (15-minute expiration) carrying user ID, email, and roles.
  - Long-lived cryptographically random Refresh Tokens (7-day expiration) stored in Redis/Database with family tracking and automatic revocation if reused.
  - Password hashing implemented using **Argon2id** (memory-hard, resistant to GPU/ASIC attacks).
