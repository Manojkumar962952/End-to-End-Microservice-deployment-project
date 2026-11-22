# Chapter 18: API Gateway Pattern, Rate Limiting & Edge Routing

```
+─────────────────────────────────────────────────────────────────────────────────────────────────────────+
|                                    API GATEWAY INGRESS ARCHITECTURE                                     |
+─────────────────────────────────────────────────────────────────────────────────────────────────────────+
| [Client: Browser / Mobile App]                                                                          |
|         │                                                                                               |
|         ▼ HTTP Requests (Port 8000)                                                                     |
| [API Gateway: Express + TypeScript]                                                                     |
| ┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐ |
| │ 1. Helmet Security Headers (HSTS, CSP, X-Frame-Options)                                              │ |
| │ 2. CORS Policy Enforcement (Whitelisted Origins)                                                    │ |
| │ 3. Correlation ID Middleware (Generates/Propagates `x-correlation-id`)                               │ |
| │ 4. Redis Token Bucket Rate Limiting (100 req/min general, 30 req/min auth)                          │ |
| │ 5. Edge JWT Authentication & Header Scrubbing (Injects `x-user-id`, `x-user-role`)                  │ |
| │ 6. Reverse Proxy Router (http-proxy-middleware with 10s Circuit Breaker Timeouts)                   │ |
| └─────────────────────────────────────────────────────────────────────────────────────────────────────┘ |
|         │                                                                                               |
|         ├── /api/v1/auth/*         ────> [auth-service:5001]                                            |
|         ├── /api/v1/users/*        ────> [user-service:5002]                                            |
|         ├── /api/v1/products/*     ────> [product-service:5003]                                         |
|         ├── /api/v1/orders/*       ────> [order-service:5004]                                           |
|         ├── /api/v1/payments/*     ────> [payment-service:5005]                                         |
|         └── /api/v1/notifications/* ───> [notification-service:5007]                                    |
+─────────────────────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
An API Gateway is a centralized architectural entry point (Reverse Proxy) that sits between external clients (browsers, mobile applications) and internal backend microservices. It encapsulates system architecture, standardizes cross-cutting concerns (security, rate limiting, authentication, telemetry, logging), and routes requests to appropriate backend services.

---

## 2. Why Do Companies Use It?
- **Single Public Entry Point**: Clients interact with a single predictable hostname (`api.ecommerce.com`) rather than managing connections to dozens of independent microservice URLs.
- **Centralized Security Enforcement**: Prevents repeating authentication, rate limiting, CORS, and SSL termination logic in every individual microservice codebase.
- **Protocol Translation & Header Sanitization**: Shields private internal networks by stripping spoofed headers and translating public HTTP REST requests to internal protocols.

---

## 3. What Problem Does It Solve?
- **Microservices Direct Exposure**: Eliminates the severe security risk of exposing internal microservice ports (5001, 5002, 5004) directly to the public internet.
- **DDoS & Resource Exhaustion**: Token-bucket rate limiting backed by Redis blocks malicious scrapers and brute-force attacks at the perimeter before backend services are impacted.
- **Scattered Distributed Tracing**: Generates a unified `x-correlation-id` at ingress, propagating it through all downstream microservice calls and logs.

---

## 4. How Does It Work Internally?
1. **Pipeline Execution Order**:
   - `helmet()`: Attaches HTTP security headers.
   - `correlationIdMiddleware`: Generates UUID v4 or extracts existing client header.
   - `createRateLimiter()`: Uses Redis atomic operations (`MULTI`/`EXEC`) to evaluate token bucket capacity for the caller's IP address. If exhausted $\rightarrow$ returns HTTP 429.
   - `requireAuth()`: Verifies cryptographic JWT signature using the cluster secret. If valid $\rightarrow$ injects claims into internal headers (`x-user-id`, `x-user-role`).
   - `createProxyMiddleware()`: Streams incoming HTTP request socket directly to target microservice with connection timeout handling.
2. **Header Scrubbing**:
   - Before forwarding, the gateway scrubs any client-supplied `x-user-id` or `x-user-role` headers to prevent header injection spoofing.

---

## 5. Where Does It Fit in Our Architecture?
The API Gateway is the **only backend service with a public port mapping** (`8000:8000`) in Docker Compose and acts as the backend target for the Kubernetes Ingress Controller.

---

## 6. How We Implemented It in This Project
Located in [`services/api-gateway/src/index.ts`](file:///c:/Users/Admin/Desktop/coporate-project/services/api-gateway/src/index.ts):
```typescript
// services/api-gateway/src/index.ts
app.use(
  '/api/v1/orders',
  requireAuth,
  createServiceProxy(config.services.orderService)
);
```

---

## 7. Configuration Examples
### Redis Token Bucket Rate Limiter (`services/api-gateway/src/middleware/rate-limiter.ts`):
```typescript
export const createRateLimiter = (options: { windowMs: number; max: number }) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = `ratelimit:${req.ip}`;
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.pexpire(key, options.windowMs);
    }
    if (current > options.max) {
      return res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please try again later.' }
      });
    }
    next();
  };
};
```

---

## 8. Commands
```powershell
# Check live gateway logs
docker compose logs -f api-gateway

# Test liveness probe
curl -i http://localhost:8000/health/live

# Test readiness probe
curl -i http://localhost:8000/health/ready
```

---

## 9. Verification
```powershell
# 1. Verify Rate Limiter Throttles at Limit
1..115 | ForEach-Object { 
  Invoke-WebRequest -Uri "http://localhost:8000/api/v1/products" -Method Get -TimeoutSec 1 -UseBasicParsing -ErrorAction SilentlyContinue
}

# 2. Verify JWT Authentication Guard (Must return 401 Unauthorized without Bearer token)
Invoke-RestMethod -Uri "http://localhost:8000/api/v1/orders" -Method Get -ErrorAction SilentlyContinue

# 3. Verify Proxy Routing to Product Service
Invoke-RestMethod -Uri "http://localhost:8000/api/v1/products" -Method Get
```

---

## 10. Common Mistakes
1. **Putting Business Logic in the Gateway**: Writing database queries, transformations, or heavy business logic turns the gateway into an unmaintainable monolith. Keep it strictly focused on routing and edge security.
2. **Missing Downstream Timeouts**: If a downstream service freezes, the gateway holds client sockets indefinitely, exhausting OS file descriptors. Always configure `timeout: 10000` (10 seconds).
3. **Leaking Internal Headers**: Allowing clients to send `x-user-id: admin` directly from the browser! Always strip or overwrite identity headers at the gateway.

---

## 11. Troubleshooting
- **HTTP 503 Service Unavailable**: The gateway cannot reach the target microservice. Verify target service container is running (`docker compose ps`) and resolves on internal DNS (`ping order-service`).
- **HTTP 429 Triggered Unexpectedly**: Redis token bucket key TTL not expiring or burst capacity set too low for multi-asset web pages.

---

## 12. Security Best Practices
- **Strict CORS Origin Whitelisting**: Never configure `Access-Control-Allow-Origin: *` with credentials enabled in production.
- **Mask Server Banners**: Disable `X-Powered-By: Express` via Helmet to prevent revealing server runtimes to vulnerability scanners.
- **Short-Lived JWT Verification**: Verify signatures at the perimeter to immediately reject forged tokens before internal services spend CPU cycles.

---

## 13. Real-World Use Cases
- **Netflix Zuul / Spring Cloud Gateway**: Routes billions of daily video streaming requests across thousands of internal microservices with dynamic canary routing and traffic shaping.
- **Kong & AWS API Gateway**: Enterprise perimeter gateways managing API monetization, rate limiting, and consumer API key authentication.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: What is the difference between an API Gateway and a Reverse Proxy like NGINX?
**Answer**: A reverse proxy (such as standard NGINX or HAProxy) focuses primarily on transport-level concerns: high-performance TCP/HTTP connection handling, SSL/TLS termination, static file serving, and round-robin load balancing. An **API Gateway** operates at the application and business layer: it understands JWT claims, executes distributed token-bucket rate limiting in Redis, injects identity contexts, coordinates Canary traffic weighting, aggregates multiple microservice APIs, and enforces API developer contracts and billing quotas.

### Q2: How does the Token Bucket rate limiting algorithm work in Redis?
**Answer**: Each client IP has a bucket with a maximum capacity $C$ and a fill rate $r$ tokens/second. When a request arrives:
1. Redis calculates tokens added based on the timestamp delta since the last request ($t_{\text{now}} - t_{\text{last}}$).
2. If tokens $\ge 1$, the request decrements 1 token and proceeds.
3. If tokens $< 1$, the request is rejected with `HTTP 429 Too Many Requests`.
Using Redis Lua scripts or atomic `MULTI`/`EXEC` ensures that concurrent requests across multiple Gateway instances evaluate bucket state atomically without race conditions.

### Q3: Why is downstream timeout configuration critical in an API Gateway?
**Answer**: Without strict timeouts, if a downstream service (e.g. `order-service`) suffers a deadlock or slow database query, incoming client connections remain open waiting for responses. As new clients connect, the Gateway rapidly exhausts its available TCP sockets, thread pool, and Linux file descriptors, causing cascading failure where the entire API Gateway crashes, taking down all other healthy microservices with it.
