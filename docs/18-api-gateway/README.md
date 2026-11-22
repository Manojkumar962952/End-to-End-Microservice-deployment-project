# Enterprise API Gateway: Complete Architectural & Operational Guide

```
+─────────────────────────────────────────────────────────────────────────────────────────────────────────+
|                                          PUBLIC CLIENTS (Web / Mobile)                                  |
+─────────────────────────────────────────────────────────────────────────────────────────────────────────+
                                                     │
                                                     ▼ HTTPS / REST
+─────────────────────────────────────────────────────────────────────────────────────────────────────────+
|                                          API GATEWAY (Port 8000)                                        |
|                                                                                                         |
|  [Layer 1: Security Headers & CORS]       Helmet, Strict-Transport-Security, Content-Security-Policy   |
|  [Layer 2: Observability & Tracing]       Correlation ID Injection (`x-correlation-id: uuid-v4`)       |
|  [Layer 3: Distributed Rate Limiting]     Redis 7 Token-Bucket Algorithm (with in-memory fallback)      |
|  [Layer 4: Authentication Verification]   JWT Signature Check, Claims Validation & Header Enrichment    |
|  [Layer 5: Reverse Proxy Routing]         http-proxy-middleware with 10s Timeouts & Circuit Breaking    |
+─────────────────────────────────────────────────────────────────────────────────────────────────────────+
          │                      │                    │                   │                    │
          ▼ HTTP                 ▼ HTTP               ▼ HTTP              ▼ HTTP               ▼ HTTP
+───────────────────+  +───────────────────+  +─────────────────+  +─────────────────+  +───────────────────+
|   Auth Service    |  |   User Service    |  | Product Service |  |  Order Service  |  |  Payment Service  |
|    (:5001)        |  |    (:5002)        |  |    (:5003)      |  |    (:5004)      |  |    (:5005)        |
+───────────────────+  +───────────────────+  +─────────────────+  +─────────────────+  +───────────────────+
```

---

## 1. What is an API Gateway?
An **API Gateway** is a specialized Layer 7 reverse proxy and architectural facade that sits between external clients (browsers, mobile applications, third-party partners) and internal microservices. It acts as the single, unified entry point for all incoming API traffic, decoupling clients from the internal topology, ports, and protocols of downstream services.

---

## 2. Why Do Companies Use It?
In mature product-based companies, exposing 10 to 100 individual microservices directly to the public internet is an operational and security nightmare:
1. **Security Attack Surface**: Exposing multiple ports and IP addresses invites direct attacks against internal microservices.
2. **Cross-Origin Complexity (CORS)**: Browsers enforce the Same-Origin Policy. Direct calls across 8 domains force developers to manage fragile CORS headers on every single service.
3. **Repeated Cross-Cutting Concerns**: Without a gateway, every engineering squad must re-implement authentication, rate limiting, request tracing, SSL termination, and IP blacklisting in their own service codebase.
4. **Protocol Mismatch**: Gateways can terminate public HTTPS/REST/JSON and translate requests into internal high-performance protocols like gRPC, AMQP, or TCP sockets.

---

## 3. What Problem Does It Solve?
| Problem Without API Gateway | Solution With API Gateway |
| :--- | :--- |
| **Client Chattiness**: Frontend must make 6 HTTP requests to 6 servers to render a checkout page. | **Request Aggregation**: Client makes 1 request to Gateway; Gateway orchestrates internal calls over sub-millisecond local networks. |
| **Coupled Architecture**: Renaming a backend service or changing its port breaks mobile apps already installed on customer phones. | **Topology Encapsulation**: Clients only know `/api/v1/orders`. Backend can be refactored or moved without client impact. |
| **DDoS Vulnerability**: Runaway client scripts or malicious actors can saturate backend databases. | **Centralized Rate Limiting**: Gateway drops abusive traffic at the network edge before backend services consume CPU. |
| **Fragmented Logs**: Requests jump between 8 services with no unified trail. | **Correlation ID Injection**: Gateway assigns `x-correlation-id` and propagates it across the entire distributed trace. |

---

## 4. How Does It Work Internally?
When a packet strikes the API Gateway on port `8000`:
1. **TCP / TLS Handshake**: The socket is accepted, and TLS is terminated (in cloud production, by the Application Load Balancer; locally by Gateway).
2. **Correlation Middleware**: Inspects the `x-correlation-id` HTTP header. If absent, it generates a fresh UUID v4 and attaches it to both the request context and the outgoing response header.
3. **Rate Limiting Engine**:
   - Computes a key: `ratelimit:<route>:<client-ip>`.
   - Executes an atomic Redis transaction: `INCR key` followed by `EXPIRE key 60`.
   - If the count exceeds the threshold (e.g., 30 req/min for auth), it halts execution immediately and returns `HTTP 429 Too Many Requests`.
4. **Authentication Check (Guard)**:
   - For protected routes (`/api/v1/orders`, `/api/v1/users`), it parses `Authorization: Bearer <JWT>`.
   - Verifies the cryptographic signature against `JWT_ACCESS_SECRET`.
   - Decodes claims (`userId`, `email`, `role`).
   - Injects identity headers into downstream requests: `x-user-id`, `x-user-email`, `x-user-role`.
5. **Reverse Proxy Dispatcher**:
   - Matches the path against the routing table (e.g. `/api/v1/orders/*` $\rightarrow$ `http://order-service:5004`).
   - Opens an internal HTTP socket with a strict 10-second timeout.
   - Streams the response back to the client.

---

## 5. Where Does It Fit in Our Architecture?
In our Docker Compose and future Kubernetes platform:
- The **API Gateway** is the **only backend service with a host-mapped port (`8000:8000`)**.
- It bridges the public network (`ecommerce-public-net`) and the private internal network (`ecommerce-internal-net`).
- Downstream microservices (`auth-service:5001`, `order-service:5004`, `postgres:5432`, `rabbitmq:5672`) are **strictly unmapped** and unreachable from outside Docker.

---

## 6. How We Implemented It in This Project
Located at [`services/api-gateway/src/index.ts`](file:///c:/Users/Admin/Desktop/coporate-project/services/api-gateway/src/index.ts):
- **Runtime**: Node.js 20 LTS with TypeScript 5.4.
- **Framework**: Express with `http-proxy-middleware` v2.
- **Security**: `helmet` (HSTS, X-Content-Type-Options, DNS prefetch control) and `cors`.
- **Rate Limiting**: Custom Redis-backed token bucket with in-memory fallback in [`services/api-gateway/src/middleware/rate-limiter.ts`](file:///c:/Users/Admin/Desktop/coporate-project/services/api-gateway/src/middleware/rate-limiter.ts).
- **Identity Injection**: [`services/api-gateway/src/middleware/auth-check.ts`](file:///c:/Users/Admin/Desktop/coporate-project/services/api-gateway/src/middleware/auth-check.ts).

---

## 7. Configuration Examples

### Gateway Route Forwarding Configuration
```typescript
// services/api-gateway/src/index.ts
const createServiceProxy = (target: string, pathRewrite?: Record<string, string>) => {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    timeout: 10000,
    proxyTimeout: 10000,
    pathRewrite,
    onProxyReq: (proxyReq, req: any) => {
      // Propagate correlation ID to downstream service
      if (req.correlationId) {
        proxyReq.setHeader('x-correlation-id', req.correlationId);
      }
      // Forward authenticated user context
      if (req.headers && req.headers['x-user-id']) {
        proxyReq.setHeader('x-user-id', req.headers['x-user-id']);
        proxyReq.setHeader('x-user-email', req.headers['x-user-email']);
        proxyReq.setHeader('x-user-role', req.headers['x-user-role']);
      }
    },
    onError: (err, _req, res: any) => {
      if (res && res.writeHead && !res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: 'Target microservice is temporarily unavailable.' }
        }));
      }
    }
  });
};
```

---

## 8. Operational & Verification Commands

### Test Gateway Liveness Probe
```powershell
curl -i http://localhost:8000/health/live
```
*Expected Output*: `HTTP/1.1 200 OK` with JSON `{"status":"UP","service":"api-gateway",...}`.

### Test Rate Limiting Trigger
Run a rapid burst of 35 requests against the auth route to trigger the 30 req/min limit:
```powershell
1..35 | ForEach-Object { 
  Invoke-RestMethod -Uri "http://localhost:8000/api/v1/auth/register" -Method Post -Body '{"email":"test@test.com"}' -ContentType "application/json" -ErrorAction SilentlyContinue
}
```
*Expected Output*: The 31st request returns `HTTP 429 Too Many Requests` with response header `X-RateLimit-Remaining: 0`.

### Inspect Gateway Live Logs
```powershell
docker compose logs -f api-gateway
```

---

## 9. Common Mistakes in Production
1. **Putting Business Logic in the Gateway**: Writing database queries, complex data formatting, or heavy compute inside the gateway turns it into a monolithic bottleneck. Keep it strictly focused on routing, security, and rate limiting.
2. **Missing Downstream Timeouts**: If `order-service` freezes and the Gateway has no timeout, the Gateway holds open thousands of sockets until the OS runs out of file descriptors (socket exhaustion).
3. **Leaking Internal Headers**: Allowing public clients to supply `x-user-id: admin` directly in their request! The Gateway must **strip or overwrite** all internal identity headers from incoming public requests before proxying.

---

## 10. Troubleshooting Guide

| Symptom | Probable Root Cause | Investigation Command | Resolution |
| :--- | :--- | :--- | :--- |
| **HTTP 503 Service Unavailable** | Downstream container crashed or is starting. | `docker compose ps` | Check if target service (e.g. `order-service`) is healthy. Inspect logs with `docker compose logs order-service`. |
| **HTTP 504 Gateway Timeout** | Downstream service took longer than 10,000ms. | `docker compose logs -f <service>` | Investigate slow database queries or unindexed locks in PostgreSQL. |
| **HTTP 429 Rate Limited** | Client exceeded token bucket threshold. | Check `X-RateLimit-Remaining` header. | Wait 60 seconds or increase threshold in `createRateLimiter(limit, window)`. |
| **CORS Policy Block** | Frontend origin missing from CORS whitelist. | Check browser DevTools console. | Verify `app.use(cors())` configuration in Gateway. |

---

## 11. Security Best Practices
- **Never Run as Root**: Ensure container runs as `USER node`.
- **Payload Size Limits**: Enforce `express.json({ limit: '1mb' })` to prevent memory exhaustion from oversized JSON payloads.
- **Header Hardening**: Use `helmet()` to enforce `X-Content-Type-Options: nosniff` and disable `X-Powered-By`.
- **Header Scrubbing**: Gateway must strip any inbound `x-user-*` headers sent by external clients to prevent spoofing.

---

## 12. Real-World Use Cases
- **Netflix Zuul / Spring Cloud Gateway**: Routes billions of requests daily across thousands of microservice instances.
- **Amazon API Gateway**: Managed serverless gateway handling authentication, AWS WAF integration, and throttling before AWS Lambda.
- **Kong / Envoy**: High-performance C++/Lua reverse proxies used by companies like Uber and Shopify for service mesh ingress.

---

## 13. Senior Interview Questions & Answers

### Q1: What is the difference between an API Gateway and an Application Load Balancer (ALB)?
> **Answer**: An ALB is a Layer 7 network traffic distributor that balances HTTP traffic across a pool of identical server instances based on round-robin or least connections. An API Gateway sits behind the ALB and handles application-level orchestration: JWT verification, request transformation, API key management, path rewrites, client-specific rate limiting, and correlation ID propagation.

### Q2: How does the Gateway prevent a cascading failure when a downstream microservice is slow?
> **Answer**: By implementing **strict socket timeouts** (e.g. 10s) and a **Circuit Breaker pattern**. When downstream latency rises or failure rates exceed 50%, the breaker trips open, instantly returning an HTTP 503 fallback to clients without opening new sockets to the struggling backend, giving it time to recover.

### Q3: How do you prevent attackers from spoofing identity by sending `x-user-id: 1` directly from their browser?
> **Answer**: The API Gateway acts as the zero-trust boundary. It **never trusts client headers**. It verifies the cryptographic signature of the client's JWT token, decodes the claims from the verified signature, and forcefully overwrites the `x-user-id` header with the verified claim before proxying the request to internal services. Internal services are placed on private networks where only the Gateway can talk to them.
