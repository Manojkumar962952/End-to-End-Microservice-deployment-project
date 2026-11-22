# Microservices Architecture & Domain Decomposition Guide

```
+─────────────────────────────────────────────────────────────────────────────────────────────────────────+
|                                    BOUNDED CONTEXTS & DATA OWNERSHIP                                    |
+─────────────────────────────────────────────────────────────────────────────────────────────────────────+
| [Auth Service]       Owns `ecommerce_auth`        (Users, Password Hashes, Refresh Tokens)               |
| [User Service]       Owns `ecommerce_user`        (Customer Profiles, Delivery Addresses)               |
| [Product Service]    Owns `ecommerce_product`     (Categories, Product Catalog, Redis Cache)            |
| [Inventory Service]  Owns `ecommerce_inventory`   (Stock Quantities, Row Locks, Reservations)           |
| [Order Service]      Owns `ecommerce_order`       (Order State Machine, Items, Total Price)             |
| [Payment Service]    Owns `ecommerce_payment`     (Transactions, Idempotency Keys, Settlement)          |
| [Notification Serv]  Owns `ecommerce_notification`(Audit Trail, Event Delivery Logs)                    |
+─────────────────────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is Microservices Architecture?
A **microservices architecture** is an architectural and organizational approach where an application is composed of small, independent services that communicate over well-defined APIs. Each service is scoped to a specific business domain, runs in its own process, and is managed by a small, autonomous engineering team.

---

## 2. Why Do Companies Use It?
1. **Independent Deployability**: Squad A can deploy updates to `product-service` 10 times a day without running regression tests on `order-service` or redeploying the whole company platform.
2. **Independent Scaling**: Flash sales cause high read traffic on products and write contention on inventory, but low activity on user profiles. Microservices allow scaling only `product-service` and `inventory-service` containers.
3. **Fault Isolation (Blast Radius)**: If `notification-service` runs out of memory or crashes, orders and payments continue to process uninterrupted.
4. **Technology Diversity**: While our platform standardizes on Node.js/TypeScript, microservices allow specific teams to use Python for machine learning or Go for high-throughput packet routing.

---

## 3. What Problem Does It Solve?
- **Monolith Deployment Deadlocks**: In large monolithic codebases, 50 developers trying to commit to a single deployment train create release bottlenecks and constant rollbacks.
- **Shared Database Lock Contention**: In a single database, write locks in one module (e.g. inventory adjustments) lock tables needed by checkout or reporting.
- **Coupled Spaghetti Dependencies**: In a monolith, developers accidentally import private classes across modules. In microservices, network boundaries enforce clean separation.

---

## 4. How Does It Work Internally?
1. **Synchronous REST Path (Queries)**:
   - Client makes an HTTP GET request to API Gateway.
   - Gateway forwards request over internal network to the owning service.
   - Owning service queries its private PostgreSQL database and returns JSON.
2. **Asynchronous Event Path (Saga Choreography)**:
   - When mutating multi-service state (e.g. Placing an Order):
     1. `Order Service` writes an order with status `PENDING` to `ecommerce_order` and publishes `order.created` to RabbitMQ.
     2. `Inventory Service` consumes `order.created`, locks the inventory rows with `SELECT ... FOR UPDATE`, checks available stock, reserves the items, and publishes `inventory.reserved`.
     3. `Payment Service` consumes `inventory.reserved`, verifies the `idempotency_key`, executes the charge, and publishes `payment.succeeded`.
     4. `Order Service` consumes `payment.succeeded` and updates order status to `CONFIRMED`.
     5. `Notification Service` consumes the event and records an audit log.
   - If payment fails: `Payment Service` publishes `payment.failed`, triggering **compensating transactions** where `Inventory Service` releases the stock hold and `Order Service` marks the order `FAILED`.

---

## 5. Where Does It Fit in Our Architecture?
Our system consists of **8 independent microservices**:
- `services/api-gateway` (Port 8000)
- `services/auth-service` (Port 5001)
- `services/user-service` (Port 5002)
- `services/product-service` (Port 5003)
- `services/order-service` (Port 5004)
- `services/payment-service` (Port 5005)
- `services/inventory-service` (Port 5006)
- `services/notification-service` (Port 5007)

---

## 6. How We Implemented It in This Project
- **Data-Per-Service**: Configured in [`docker/init-scripts/01-init-databases.sql`](file:///c:/Users/Admin/Desktop/coporate-project/docker/init-scripts/01-init-databases.sql).
- **Shared Contracts**: Single source of truth for DTOs and Domain Events located in [`shared/contracts/`](file:///c:/Users/Admin/Desktop/coporate-project/shared/contracts).
- **Decoupled Messaging**: All cross-service events published to RabbitMQ exchange `ecommerce.events`.

---

## 7. Configuration Examples: The Saga Event Contract
```typescript
// shared/contracts/src/events.ts
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
```

---

## 8. Operational Commands

### Check Microservice Process & Health Status
```powershell
docker compose ps
```

### Inspect RabbitMQ Event Queues
Open **`http://localhost:15672`** (guest / guest). Inspect:
- `order.lifecycle.updates` queue
- `inventory.order.created` queue
- `payment.inventory.reserved` queue

### Trace Distributed Logs by Correlation ID
```powershell
docker compose logs | Select-String "b945ecac-6d86-4f12-b052-f697d6893f29"
```

---

## 9. Common Mistakes in Production
1. **Direct Cross-Database Queries**: Microservice A executing a SQL `JOIN` against Microservice B's tables breaks the architecture and creates a distributed monolith.
2. **Missing Idempotency**: Network packets get retransmitted. Without unique idempotency keys, duplicate RabbitMQ deliveries cause double-billing.
3. **Synchronous Cascading Chains**: Service A calling B, B calling C, C calling D over HTTP creates high latency, tight coupling, and cascading outages.

---

## 10. Troubleshooting Guide

| Symptom | Probable Root Cause | Investigation Command | Resolution |
| :--- | :--- | :--- | :--- |
| **Order stuck in `PENDING`** | `inventory-service` or `payment-service` queue consumer stopped. | Inspect queue depth in RabbitMQ (`localhost:15672`). | Restart consumer service or inspect unhandled message exceptions. |
| **Overselling During Flash Sale** | Missing row-level lock during reservation check. | Check `inventory-service/src/index.ts` SQL query. | Ensure `SELECT ... FOR UPDATE` or optimistic versioning is used. |
| **Duplicate Orders Created** | Client retried without an `idempotency-key`. | Inspect `orders` table `idempotency_key` column. | Require `idempotency-key` header on all `POST /orders` calls. |

---

## 11. Security Best Practices
- **Network Isolation**: Backend services must never bind to `0.0.0.0` on the host machine.
- **Zero Trust Authentication**: Services trust identity claims ONLY when delivered via validated headers from the API Gateway.
- **Database Least Privilege**: In production RDS, each service connects with a dedicated database user granted permissions solely to its own schema.

---

## 12. Real-World Use Cases
- **Amazon**: Migrated from monolith "Obidos" in 2001 to thousands of microservices, decoupling checkout from product catalog.
- **Uber**: Operates over 4,000 microservices communicating via Apache Kafka and RPC.

---

## 13. Senior Interview Questions & Answers

### Q1: What is the Saga Pattern, and why not use 2-Phase Commit (2PC)?
> **Answer**: Two-Phase Commit holds distributed locks across all participating databases until all participants vote to commit. In distributed systems, this creates severe lock contention, reduces throughput by 90%+, and risks distributed deadlocks during network partitions. The **Saga Pattern** breaks the transaction into local ACID transactions coordinated via asynchronous events. If any step fails, compensating transactions are executed to undo prior steps.

### Q2: How do you handle distributed queries (e.g. show order history with product names) without cross-database joins?
> **Answer**: Two industry patterns:
> 1. **Data Snapshotting**: When creating the order, snapshot the product name and unit price directly into `order_items`. In e-commerce, this is legally required so that past orders show historical purchase prices rather than future price changes.
> 2. **API Composition / CQRS**: An API Gateway or aggregator service calls both services and merges the JSON payloads, or domain events stream updates into a read-optimized query store (Elasticsearch or read-replica).
