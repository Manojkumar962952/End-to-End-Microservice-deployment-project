# Chapter 04: Microservices Architecture & Distributed Choreographed Sagas

```
+───────────────────────────────────────────────────────────────────────────────────────────────────+
|                          DISTRIBUTED SAGA TRANSACTION FLOW (CHOREOGRAPHY)                         |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
| 1. Client POST /orders ──> [API Gateway] ──> [Order Service]                                       |
|                                                     │                                             |
|                                    Emits `order.created` (PENDING)                                |
|                                                     ▼                                             |
|                                       [RabbitMQ: ecommerce.events]                                |
|                                                     │                                             |
|                              ┌──────────────────────┴───────────────────────┐                     |
|                              ▼                                              ▼                     |
|                   [Inventory Service]                                [Notification Service]       |
|                 (Reserves stock hold via                               (Simulates order           |
|                  SELECT ... FOR UPDATE)                                confirmation email)        |
|                              │                                                                    |
|               Emits `inventory.reserved`                                                          |
|                              ▼                                                                    |
|                        [RabbitMQ]                                                                 |
|                              │                                                                    |
|                              ▼                                                                    |
|                      [Payment Service]                                                            |
|                 (Processes card settlement)                                                       |
|                              │                                                                    |
|               ┌──────────────┴──────────────┐                                                     |
|               ▼ (SUCCESS)                   ▼ (FAILURE)                                           |
|   Emits `payment.succeeded`     Emits `payment.failed`                                            |
|               │                             │                                                     |
|               ▼                             ▼                                                     |
|        [Order Service]              [Compensating Action: Inventory Service]                      |
|     (Marks CONFIRMED)               (Releases stock reservation hold back to warehouse)           |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
A Microservices Architecture is a distributed software design pattern in which an application is structured as a collection of loosely coupled, independently deployable, and autonomously operating services. Each service encapsulates a distinct business capability (Bounded Context in Domain-Driven Design) and exclusively owns its data store (Database-per-Service pattern).

---

## 2. Why Do Companies Use It?
- **Autonomous Feature Velocity**: Independent engineering teams build, test, and deploy services without coordinating branch merges or waiting for company-wide release windows.
- **Granular Elastic Scalability**: Scale compute resources strictly for high-traffic services (such as product search or order placement) rather than scaling an entire heavy monolith.
- **Fault Containment (Bulkhead Pattern)**: A failure, memory leak, or crash in the notification or recommendation service does not bring down the critical payment and checkout pathways.

---

## 3. What Problem Does It Solve?
- **The "Big Ball of Mud" Monolith**: Prevents monolithic codebases where tightly coupled database joins and spaghetti dependencies make refactoring or upgrading runtimes terrifying.
- **Deployment Blast Radius**: Eliminates the catastrophic scenario where a small bug in a marketing widget takes down core order processing.
- **Technology Lock-In**: Allows teams to adopt polyglot tech stacks (e.g., Python for machine learning, Node.js for high-throughput I/O, Go for low-latency networking) suited to specific domain problems.

---

## 4. How Does It Work Internally?
1. **Bounded Context & Domain Isolation**:
   - Services communicate strictly via public API contracts (HTTP REST / gRPC) or asynchronous domain events (AMQP / RabbitMQ).
   - Under no circumstances does a service read or write to another service's database tables directly.
2. **Asynchronous Choreographed Saga Pattern**:
   - In distributed systems, traditional Two-Phase Commit (2PC) distributed locking violates the CAP theorem and creates high latency.
   - Choreography coordinates long-running distributed transactions through domain events published to RabbitMQ topic exchanges.
   - **Compensating Transactions**: If any downstream step fails (e.g. credit card declined), failure events trigger automated compensating transactions (e.g., releasing stock holds, canceling orders) to guarantee eventual consistency.

---

## 5. Where Does It Fit in Our Architecture?
Our enterprise platform partitions e-commerce operations across **8 autonomous microservices**:
1. `services/api-gateway` (Port 8000): Ingress reverse proxy, token-bucket rate limiter, JWT authentication edge.
2. `services/auth-service` (Port 5001): Customer identity, scrypt password hashing, refresh token rotation.
3. `services/user-service` (Port 5002): Customer shipping/billing profiles.
4. `services/product-service` (Port 5003): Catalog search and inventory availability with Redis read-through caching.
5. `services/inventory-service` (Port 5006): Warehouse stock tracking, concurrency reservation locks.
6. `services/order-service` (Port 5004): Order state machine transitions, checkout initiator.
7. `services/payment-service` (Port 5005): Simulated payment gateway, idempotency key enforcement.
8. `services/notification-service` (Port 5007): Transactional email and audit dispatch engine.

---

## 6. How We Implemented It in This Project
- **Shared Contracts (`shared/contracts`)**: Pure TypeScript library defining shared DTOs, Zod request validation schemas, and Saga event schemas.
- **Database Schema Isolation**: Seven isolated PostgreSQL databases (`ecommerce_auth`, `ecommerce_user`, `ecommerce_product`, `ecommerce_order`, `ecommerce_payment`, `ecommerce_inventory`, `ecommerce_notification`) provisioned in `docker/init-scripts/01-init-databases.sql`.
- **AMQP Event Bus**: RabbitMQ exchange `ecommerce.events` routes domain events (`order.created`, `inventory.reserved`, `payment.succeeded`, `payment.failed`).

---

## 7. Configuration Examples
### Saga Domain Event Payloads (`shared/contracts/src/events.ts`):
```typescript
export interface OrderCreatedPayload {
  orderId: string;
  customerId: string;
  items: Array<{ productId: string; quantity: number }>;
  totalCents: number;
  currency: string;
}

export interface InventoryReservedPayload {
  orderId: string;
  reservationId: string;
}

export interface PaymentSucceededPayload {
  orderId: string;
  paymentId: string;
  transactionRef: string;
  amountCents: number;
}

export interface PaymentFailedPayload {
  orderId: string;
  reason: string;
}
```

---

## 8. Commands
```powershell
# View running microservice container fleet
docker compose ps

# Follow real-time distributed logs for Order Service
docker compose logs -f order-service

# Check message queue consumer counts and unacknowledged messages
docker exec -it ecommerce-rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged consumers

# Restart a specific microservice gracefully
docker compose restart inventory-service
```

---

## 9. Verification
```powershell
# 1. Execute full local end-to-end integration test suite
powershell -ExecutionPolicy Bypass -File .\scripts\verify-local.ps1

# 2. Verify correlation ID propagation across distributed microservices
docker compose logs | Select-String "x-correlation-id"

# 3. Verify database isolation (Confirm order-service user cannot query auth database)
docker exec -it ecommerce-postgres psql -U ecommerce_admin -d ecommerce_order -c "\dt"
```

---

## 10. Common Mistakes
1. **Direct Cross-Database Queries**: Service A running SQL joins on Service B's database tables turns your architecture into a distributed monolith, coupling schemas and causing cascading failures.
2. **Missing Idempotency**: Network retries and duplicate AMQP message deliveries will charge customers twice unless endpoints enforce unique `idempotency-key` checks.
3. **Synchronous REST Cascades**: Service A calling B, calling C, calling D over HTTP creates exponential latency and means any single failure drops the entire chain. Use asynchronous messaging.

---

## 11. Troubleshooting
- **Order Stuck in `PENDING` State**: The downstream consumer (`inventory-service` or `payment-service`) crashed or lost its AMQP channel. Inspect RabbitMQ Management UI (`http://localhost:15672`) for unacknowledged messages.
- **Overselling During Flash Sales**: Inventory counts went negative. Root cause: lacking database row-level locking. Verify `inventory-service` executes `SELECT ... FOR UPDATE` before decrementing stock.
- **Connection Refused on Boot**: Backend services booted before PostgreSQL was accepting connections. Enforce `depends_on: { postgres: { condition: service_healthy } }`.

---

## 12. Security Best Practices
- **Network Segmentation**: Internal microservices and databases must NEVER bind to public host ports (`0.0.0.0`).
- **Identity Forwarding**: Microservices trust identity claims only when delivered via validated `x-user-id` and `x-user-role` headers injected by the API Gateway.
- **Secret Separation**: Each microservice receives only the database credentials and secrets necessary for its specific bounded context.

---

## 13. Real-World Use Cases
- **Amazon**: Migrated from monolith "Obidos" in 2001 to thousands of microservices, decoupling checkout from product catalog and increasing release frequency to thousands of deployments daily.
- **Netflix**: Runs over 1,000 microservices across AWS, pioneering asynchronous messaging, chaos engineering, and circuit breaking patterns.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: What is the Saga Pattern, and why is it preferred over Two-Phase Commit (2PC) in cloud microservices?
**Answer**: Two-Phase Commit (2PC) holds distributed locks across all participating databases until all participants vote to commit. In cloud environments, network partitions and slow database nodes cause distributed locks to hold indefinitely, reducing system throughput by over 90% and causing cascading thread exhaustion. The **Saga Pattern** breaks the distributed transaction into a sequence of local ACID transactions coordinated via asynchronous domain events. If any step fails, compensating transactions are executed to undo prior work, providing eventual consistency without distributed locking.

### Q2: How do you query customer order history with product details without cross-database SQL joins?
**Answer**:
1. **Data Snapshotting**: When creating an order, snapshot the product name and price directly into `order_items`. In e-commerce, this is legally required so that past invoices show the historical purchase price rather than future catalog changes.
2. **API Composition**: An API Gateway or aggregation service queries `/orders` and `/products` separately and combines the JSON payloads before returning them to the client.
3. **CQRS (Command Query Responsibility Segregation)**: Domain events stream data changes into a read-optimized query database (like Elasticsearch or a materialized view) dedicated purely to fast read queries.

### Q3: What is the difference between Choreographed and Orchestrated Sagas?
**Answer**:
- **Choreographed Saga**: Decentralized. Microservices listen to domain events and decide autonomously what action to take (e.g. `inventory-service` consumes `order.created` and publishes `inventory.reserved`). It is simple and avoids single points of failure, but can be harder to visualize as the system grows.
- **Orchestrated Saga**: Centralized. A dedicated orchestrator state machine (e.g., AWS Step Functions or Temporal) sends explicit command messages to services and tracks state progression. It provides central visibility, but introduces an orchestrator dependency.
