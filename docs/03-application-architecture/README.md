# Chapter 03: End-to-End Application Architecture & Microservices Decomposition

```
+───────────────────────────────────────────────────────────────────────────────────────────────────+
|                                    END-TO-END APPLICATION ARCHITECTURE                            |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
| [Frontend SPA: React 18 + TypeScript + Vite] (Port 3000)                                          |
|         │                                                                                         |
|         ▼ HTTP REST Requests                                                                      |
| [API Gateway: Express + Helmet + Redis Rate Limiter] (Port 8000)                                   |
|         │                                                                                         |
|         ├── /api/v1/auth/*         ────> [auth-service:5001]       (PostgreSQL: ecommerce_auth)   |
|         ├── /api/v1/users/*        ────> [user-service:5002]       (PostgreSQL: ecommerce_user)   |
|         ├── /api/v1/products/*     ────> [product-service:5003]    (PostgreSQL: ecommerce_product |
|         │                                                           + Redis Read-Through Cache)   |
|         ├── /api/v1/orders/*       ────> [order-service:5004]      (PostgreSQL: ecommerce_order)  |
|         ├── /api/v1/payments/*     ────> [payment-service:5005]    (PostgreSQL: ecommerce_payment)|
|         │                                                                                         |
|         ▼ Asynchronous Event Bus (RabbitMQ: ecommerce.events Topic Exchange)                      |
|         ├── [inventory-service:5006] (PostgreSQL: ecommerce_inventory - Stock Reservation Hold)   |
|         └── [notification-service:5007] (PostgreSQL: ecommerce_notification - Simulated Email)   |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
Application Architecture describes the overall structural blueprint of the software system: the breakdown into UI and backend services, their internal modularity, protocol interfaces, data stores, communication patterns, and deployment runtime environments.

---

## 2. Why Do Companies Use It?
- **Cognitive Load Management**: Clear separation of concerns enables developers to focus on specific business domains without needing to grasp every detail of the entire company's codebase.
- **Technology Alignment**: Matches appropriate database engines and caching solutions to specific workload characteristics (e.g. Redis for sub-millisecond caching; PostgreSQL for ACID transactional ledgers).
- **Future-Proof Evolution**: Standardized contracts allow swapping internal implementations (e.g. migrating from Express to NestJS or Go) without breaking external consumers.

---

## 3. What Problem Does It Solve?
- **Tight Architectural Coupling**: Prevents frontend UI components from having hardcoded knowledge of backend database schemas or internal microservice endpoints.
- **Uncontrolled Data Mutation**: Enforces that data mutations occur exclusively through validated domain APIs rather than rogue direct database writes.
- **Cascading Failure Vulnerability**: Isolates synchronous request paths from asynchronous background processing.

---

## 4. How Does It Work Internally?
1. **Three-Tier Architectural Model**:
   - **Presentation Tier**: React 18 SPA compiled into static assets served via high-performance NGINX Alpine web servers.
   - **API Ingress Tier**: Central API Gateway handling rate limiting, TLS termination, CORS, and JWT verification.
   - **Service & Domain Tier**: 7 autonomous Node.js microservices interacting over synchronous HTTP and asynchronous AMQP messaging.
2. **Correlation ID Tracing Flow**:
   - `api-gateway` injects `x-correlation-id`.
   - Downstream microservices propagate this correlation header across HTTP client headers and AMQP message headers.
   - Structured JSON loggers record the correlation ID with every log line.

---

## 5. Where Does It Fit in Our Architecture?
This chapter provides the foundational blueprint connecting the frontend, backend services, databases, message brokers, and infrastructure container topologies.

---

## 6. How We Implemented It in This Project
Detailed architecture guides and sequence diagrams are maintained in [`docs/03-application-architecture/ARCHITECTURE.md`](file:///c:/Users/Admin/Desktop/coporate-project/docs/03-application-architecture/ARCHITECTURE.md).

---

## 7. Configuration Examples
### Monorepo Workspaces Configuration (`package.json`):
```json
{
  "name": "corporate-project",
  "workspaces": [
    "shared/*",
    "services/*",
    "frontend"
  ]
}
```

---

## 8. Commands
```powershell
# Build all monorepo workspaces in topological order
npm run build

# Start the full 12-container platform locally
docker compose up -d

# Verify all services are healthy and responsive
powershell -ExecutionPolicy Bypass -File .\scripts\verify-local.ps1
```

---

## 9. Verification
```powershell
# Verify that API Gateway and Frontend are accessible on host ports
curl -I http://localhost:3000
curl -I http://localhost:8000/health/live
```

---

## 10. Common Mistakes
1. **Sharing Database Tables Across Services**: Allowing multiple services to read or write to the same table breaks bounded contexts and prevents independent schema migrations.
2. **Synchronous Notification Dispatch**: Sending transactional emails synchronously during checkout blocks customer response times if the SMTP server is slow. Always dispatch via background message queues.
3. **Missing Correlation IDs**: Debugging multi-service failures without an end-to-end request identifier requires manually guessing timestamps.

---

## 11. Troubleshooting
- **Frontend Fails to Fetch Products**: Inspect browser Network tab. Check if the API Gateway at `http://localhost:8000` is running and verify CORS headers allow origin `http://localhost:3000`.

---

## 12. Security Best Practices
- **Header Scrubbing**: Gateway strips client-submitted internal headers before forwarding requests.
- **Least Privilege Database Roles**: Each service connects using a distinct database user with access limited to its own schema.

---

## 13. Real-World Use Cases
- **Enterprise Retail Platforms**: Target, Walmart, and Amazon run decoupled architectures separating browse/catalog browsing from warehouse fulfillment and payment settlement.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: What are the primary trade-offs of Microservices vs Monolithic Architecture?
**Answer**:
- **Monoliths**: Simple to develop, deploy, and debug locally. Transactional integrity is easily maintained with local ACID transactions. However, as organizations grow, monoliths suffer from long CI/CD build queues, tightly coupled code, deployment bottlenecks, and difficulty scaling individual hot spots.
- **Microservices**: Enable autonomous team velocity, independent deployments, fault containment, and granular auto-scaling. The trade-offs are significant: distributed data management complexity (Sagas instead of ACID), network latency, partial failure modes, and the need for sophisticated observability (distributed tracing, log aggregation).

### Q2: Why is Database-per-Service a non-negotiable rule in true microservices architectures?
**Answer**: If two microservices share the same database tables:
1. Team A cannot alter their database schema without risking breaking Team B's application code.
2. The services cannot be scaled or migrated to a different database technology independently.
3. A performance problem or locking transaction caused by one service impacts the database CPU/connection pool for the other service.
Database isolation guarantees absolute autonomy.

### Q3: What is the Strangler Fig pattern in legacy system modernization?
**Answer**: The Strangler Fig pattern is an incremental migration strategy to replace a legacy monolithic application with microservices. Instead of a risky "Big Bang" rewrite, an API Gateway is placed in front of the legacy monolith. New features and decomposed modules are developed as microservices, and the API Gateway redirects traffic for those specific endpoints to the new services. Over time, the microservices "strangle" and replace the monolith until the legacy application can be safely decommissioned.
