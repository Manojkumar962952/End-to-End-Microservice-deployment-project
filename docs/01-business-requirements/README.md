# Chapter 01: Business Requirements & Domain Boundaries

```
+───────────────────────────────────────────────────────────────────────────────────────────────────+
|                                  BUSINESS DOMAIN BOUNDARIES (DDD)                                 |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
| [Identity & Access] ──> Customer Registration, Login, Token Revocation, RBAC (Customer, Admin)     |
| [Customer Profile]  ──> Addresses, Contact Details (Decoupled from Auth Credentials)              |
| [Product Catalog]   ──> Categories, Specifications, Stock Visibility, Redis Cache Invalidation    |
| [Inventory Control] ──> Concurrency Safe Holds, SELECT ... FOR UPDATE, Prevent Overselling        |
| [Order Management]  ──> Checkout Lifecycle State Machine (PENDING -> CONFIRMED / CANCELLED)       |
| [Payment Processing]──> Idempotent Settlement Simulation, Financial Transaction Audit             |
| [Notifications]     ──> Event-driven simulated customer email dispatch                            |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
Business Requirements Engineering defines the formal functional rules, operational constraints, domain boundaries, and Service Level Objectives (SLOs) that a software platform must satisfy to deliver measurable commercial value to customers and business stakeholders.

---

## 2. Why Do Companies Use It?
- **Alignment Between Product & Engineering**: Prevents building technically impressive architectures that fail to solve actual business and customer problems.
- **Preventing Scope Creep**: Establishes unambiguous acceptance criteria for features before code is authored.
- **Guiding Distributed Decomposition**: Uses Domain-Driven Design (DDD) Bounded Contexts to dictate where microservice boundaries and isolated databases belong.

---

## 3. What Problem Does It Solve?
- **Overselling & Revenue Loss**: Eliminates race conditions during high-volume flash sales where multiple customers buy the same warehouse item.
- **Regulatory Non-Compliance**: Enforces GDPR, PCI-DSS, and SOC 2 requirements from day one (such as password hashing standards and PII data scrubbing).
- **Silent Transaction Failure**: Guarantees deterministic order state transitions so customers are never charged without an order confirmation.

---

## 4. How Does It Work Internally?
1. **Domain-Driven Design (DDD) Strategic Design**:
   - The platform is partitioned into autonomous Bounded Contexts.
   - Each context owns its Ubiquitous Language, relational data schema, and domain events.
2. **Deterministic State Machine**:
   - Orders strictly transition through valid state progressions:
     $$\text{PENDING} \longrightarrow \text{INVENTORY\_RESERVED} \longrightarrow \text{PAID} \longrightarrow \text{CONFIRMED}$$
   - Any failure in the flow triggers an atomic transition to $\text{FAILED}$ or $\text{CANCELLED}$.

---

## 5. Where Does It Fit in Our Architecture?
Business requirements establish the boundaries of the 8 microservices, their schema isolation, and the asynchronous event schemas defined in [`shared/contracts/`](file:///c:/Users/Admin/Desktop/coporate-project/shared/contracts).

---

## 6. How We Implemented It in This Project
Detailed requirements specifications are recorded in [`docs/01-business-requirements/REQUIREMENTS.md`](file:///c:/Users/Admin/Desktop/coporate-project/docs/01-business-requirements/REQUIREMENTS.md) and enforced via Zod contract schemas in `shared/contracts/src/dtos.ts`.

---

## 7. Configuration Examples
### Order State Transition Rules:
```typescript
export enum OrderStatus {
  PENDING = 'PENDING',
  INVENTORY_RESERVED = 'INVENTORY_RESERVED',
  CONFIRMED = 'CONFIRMED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  CANCELLED = 'CANCELLED'
}
```

---

## 8. Commands
```powershell
# View requirements and user stories documentation
Get-Content docs/01-business-requirements/REQUIREMENTS.md

# Verify contract test suite
npm test --workspace shared/contracts
```

---

## 9. Verification
```powershell
# Verify that order status transitions correctly during a real purchase
powershell -ExecutionPolicy Bypass -File .\scripts\verify-local.ps1
```

---

## 10. Common Mistakes
1. **Coupling Authentication with Customer Profiles**: Storing credit cards or shipping addresses in the authentication table. Keep auth credentials isolated in `ecommerce_auth`.
2. **Allowing Negative Inventory**: Failing to enforce database constraints (`CHECK (available_quantity >= 0)`).
3. **Changing Past Order Prices**: Reading live product catalog prices when displaying historical invoices. Always snapshot prices at the moment of order creation.

---

## 11. Troubleshooting
- **Order State Stuck in `PENDING`**: Downstream payment or inventory event consumer failed to process. Check RabbitMQ dead-letter queues.

---

## 12. Security Best Practices
- **Strict Role-Based Access Control (RBAC)**: Support roles `CUSTOMER`, `ADMIN`, `SERVICE`.
- **Audit Trails**: Maintain append-only transaction logs for all financial mutations.

---

## 13. Real-World Use Cases
- **Shopify & Amazon**: E-commerce platforms processing millions of checkouts per minute while maintaining absolute inventory consistency and payment settlement idempotency.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: How do you identify microservice boundaries using Domain-Driven Design (DDD)?
**Answer**: By identifying **Bounded Contexts**. Look for natural transactional boundaries, differing operational cadences, and distinct domain models. For example, in the Product Catalog context, a "Product" has descriptions, categories, and SEO tags; in the Inventory context, the same physical item is tracked purely as a SKU with quantity counts and warehouse bin locations. Forcing them into one database table creates tight coupling. Splitting them into autonomous services with isolated schemas enables independent scaling and maintenance.

### Q2: Why must an e-commerce platform snapshot prices at order creation time?
**Answer**: If an order references product prices via a foreign key `JOIN products ON ...`, any future price change or promotion update made by a store administrator retroactively alters the historical cost of past orders. This violates legal accounting and tax regulations. Snapshotting the unit price into the `order_items` record ensures the historical transaction is immutable.

### Q3: How do you handle non-functional requirements (NFRs) like high availability and latency?
**Answer**: NFRs must be converted into quantifiable Service Level Objectives (SLOs). For availability (e.g. 99.95%), implement Multi-AZ node redundancy, Pod Disruption Budgets, and health probes. For latency (e.g. p99 < 200ms), implement Redis caching, database indexes, connection pooling, and asynchronous messaging for non-blocking operations.
