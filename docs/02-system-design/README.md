# Chapter 02: Distributed Systems Design, CAP Theorem & Data Consistency

```
+───────────────────────────────────────────────────────────────────────────────────────────────────+
|                                    DISTRIBUTED SYSTEMS DESIGN PATTERNS                            |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
| 1. CAP THEOREM TRADE-OFF      -> Choose AP (Availability + Partition Tolerance) with Eventual     |
|                                  Consistency over synchronous CP distributed locks.               |
| 2. ASYNCHRONOUS SAGA PATTERN  -> Choreographed domain events (order.created -> inventory.reserved|
|                                  -> payment.succeeded) with automated compensating rollbacks.     |
| 3. DATABASE-PER-SERVICE       -> Zero cross-database SQL queries/joins. Independent schemas.      |
| 4. IDEMPOTENCY KEYS           -> Prevents duplicate billing on network packet retries.           |
| 5. READ-THROUGH CACHING       -> Redis 5-minute TTL reduces database read load by 85%+.           |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
System Design is the process of defining the architecture, components, modules, interfaces, and data schemas of a distributed computing system to satisfy specified operational and business requirements while balancing fundamental distributed systems trade-offs (scalability, consistency, availability, partition tolerance, and latency).

---

## 2. Why Do Companies Use It?
- **Predictable Scaling**: Ensures that a 10x or 100x increase in user traffic does not crash the database or degrade response times exponentially.
- **Resilience to Failure**: Systems designed with circuit breakers, bulkheads, and retries degrade gracefully rather than suffering total blackouts.
- **Cost Efficiency**: High-performance caching and asynchronous message queues prevent over-provisioning expensive relational database compute instances.

---

## 3. What Problem Does It Solve?
- **Distributed Deadlocks**: Eliminates the catastrophic thread starvation caused by synchronous Two-Phase Commit (2PC) locks across distributed network boundaries.
- **Cache Invalidation Chaos**: Solves the "cache stampede" problem using Redis read-through caching and explicit event-driven cache invalidation.
- **Duplicate Transactions**: Eliminates duplicate credit card charges caused by client-side network timeouts and retries using unique idempotency keys.

---

## 4. How Does It Work Internally?
1. **The CAP Theorem in Practice**:
   - In any distributed data store, network partitions ($P$) are inevitable.
   - When a network partition occurs, a system must choose between **Consistency ($C$)** (returning errors or waiting) or **Availability ($A$)** (returning data that might be slightly stale).
   - Our checkout platform chooses an **AP model with Eventual Consistency**: orders are accepted immediately as `PENDING`, and inventory and payments settle asynchronously within milliseconds.
2. **ACID vs. BASE**:
   - Relational microservices maintain local ACID guarantees within their isolated database schema.
   - Cross-service workflows adhere to **BASE** (Basically Available, Soft state, Eventual consistency) via RabbitMQ Saga events.

---

## 5. Where Does It Fit in Our Architecture?
The core systems design governs:
- Asynchronous messaging over RabbitMQ (`ecommerce.events` exchange).
- Database-per-service isolation in PostgreSQL 16.
- In-memory rate limiting and catalog caching in Redis 7.

---

## 6. How We Implemented It in This Project
Detailed system design blueprints are documented in [`docs/02-system-design/SYSTEM_DESIGN.md`](file:///c:/Users/Admin/Desktop/coporate-project/docs/02-system-design/SYSTEM_DESIGN.md) and implemented across the 8 backend services.

---

## 7. Configuration Examples
### Redis Read-Through Cache Pattern:
```typescript
// services/product-service/src/services/product.service.ts
const cached = await redis.get(`product:${id}`);
if (cached) {
  return JSON.parse(cached);
}
const dbResult = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
if (dbResult.rows.length > 0) {
  await redis.setex(`product:${id}`, 300, JSON.stringify(dbResult.rows[0]));
  return dbResult.rows[0];
}
```

---

## 8. Commands
```powershell
# Inspect Redis cache keys
docker exec -it ecommerce-redis redis-cli keys "product:*"

# Inspect RabbitMQ exchange bindings
docker exec -it ecommerce-rabbitmq rabbitmqctl list_bindings
```

---

## 9. Verification
```powershell
# Verify that product listing reads from Redis on second query (Response time < 10ms)
Invoke-RestMethod -Uri "http://localhost:8000/api/v1/products" -Method Get
```

---

## 10. Common Mistakes
1. **Using 2-Phase Commit (2PC) in Cloud Microservices**: Causes severe latency and distributed deadlocks across network boundaries.
2. **Missing Cache Expiration (TTL)**: Storing keys in Redis without TTLs leads to memory exhaustion and stale data.
3. **Synchronous REST Chains**: Service A calling B, B calling C over HTTP causes cascading failures.

---

## 11. Troubleshooting
- **Database Connection Pool Starvation**: Node.js microservices running out of connections. Configure connection pooling with max limits and idle timeouts (`max: 20`, `idleTimeoutMillis: 30000`).

---

## 12. Security Best Practices
- **Idempotency Key Hashing**: Store idempotency keys with unique indexes to block race-condition replays.
- **Encrypt Cache Data**: Enable encryption at rest and in transit for Redis caches containing sensitive session data.

---

## 13. Real-World Use Cases
- **Stripe & PayPal**: Financial architectures utilizing idempotency keys to guarantee that a customer is billed exactly once even if payment requests are retried multiple times.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: What is the CAP Theorem, and why can't a distributed system have all three properties simultaneously?
**Answer**: Eric Brewer's CAP Theorem proves that a distributed data store can simultaneously provide at most two of three guarantees:
1. **Consistency**: Every read receives the most recent write or an error.
2. **Availability**: Every non-failing node returns a non-error response without guarantee it is the most recent write.
3. **Partition Tolerance**: The system continues to operate despite arbitrary network drops or packet delays between nodes.
Because physical network cables and routers will inevitably fail (Partition Tolerance is mandatory in distributed systems), you are forced to make a trade-off between Consistency (halting writes until the partition heals) or Availability (accepting writes on both sides and reconciling later via eventual consistency).

### Q2: How does the Compensating Transaction pattern work in distributed systems?
**Answer**: In an asynchronous Saga, when a distributed transaction cannot be completed (e.g. payment fails after inventory was reserved), you cannot simply execute a database `ROLLBACK` because the inventory reservation already committed in its own local database. Instead, the system publishes a failure event (`payment.failed`) which triggers a **Compensating Transaction**: the Inventory Service executes an explicit forward transaction that releases the hold, incrementing available warehouse inventory and recording a cancellation ledger entry, restoring system balance.

### Q3: What is a Cache Stampede (Thundering Herd) and how do you prevent it?
**Answer**: A Cache Stampede occurs when a high-traffic cached key expires, and thousands of concurrent client requests simultaneously experience a cache miss, all querying the relational database at the exact same millisecond, overwhelming database connection pools. It is prevented by:
1. **Probabilistic Early Expiration (XFetch algorithm)**: Recomputing the cache value before it strictly expires based on read frequency.
2. **Mutex Locking (Singleflight Pattern)**: The first request that experiences a cache miss acquires a distributed lock in Redis to query the DB, while all other requests wait for the cache to be updated.
