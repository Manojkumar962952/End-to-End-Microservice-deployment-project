# Chapter 22: Zero-Downtime Deployment Strategies: Rolling, Blue/Green & Canary

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                               DEPLOYMENT STRATEGIES COMPARISON                            |
+───────────────────────────────────────────────────────────────────────────────────────────+
| 1. ROLLING UPDATE (Default Kubernetes)                                                    |
|    [Pod v1] [Pod v1] [Pod v1] ──> [Pod v2] [Pod v1] [Pod v1] ──> [Pod v2] [Pod v2] [Pod v2]  |
|    • Pros: Zero extra infrastructure cost; smooth gradual transition.                     |
|    • Cons: Both v1 and v2 run simultaneously (requires backwards-compatible DB schemas). |
|                                                                                           |
| 2. BLUE / GREEN DEPLOYMENT (Instant Cutover & Instant Rollback)                            |
|    [Active: Blue Environment v1 (100% Traffic)] ──┐                                       |
|                                                   ├── [Router / ALB Flips Target Group]   |
|    [Idle:   Green Environment v2 (0% Traffic)]   ──┘                                      |
|    • Pros: Instant rollback; full validation of Green in production before traffic flip.  |
|    • Cons: Doubles compute infrastructure cost during deployment window.                  |
|                                                                                           |
| 3. CANARY DEPLOYMENT (Argo Rollouts / Flagger)                                            |
|    [95% Traffic to Stable v1] ──┐                                                         |
|                                 ├── [Ingress-NGINX / Service Mesh Weighted Routing]       |
|    [ 5% Traffic to Canary v2] ──┘                                                         |
|    • Pros: Limits blast radius; automated rollback based on real-time error rate metrics. |
|    • Cons: Complex routing configuration and metric analysis requirements.                |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
Zero-Downtime Deployment is a software delivery methodology that releases new application versions into production without interrupting active user traffic, dropping HTTP connections, or displaying maintenance error screens to end customers. The primary deployment patterns are **Rolling Updates**, **Blue/Green Deployments**, and **Canary Deployments**.

---

## 2. Why Do Companies Use It?
- **Business Continuity & Revenue Protection**: E-commerce platforms lose thousands of dollars per minute of downtime during peak trading hours. Deployments must occur during regular business hours without customer disruption.
- **Continuous Delivery Velocity**: Enables engineering teams to ship small, low-risk releases 10+ times per day instead of holding risky midnight maintenance windows once a month.
- **Risk Mitigation**: Canary releases expose new features to only 1–5% of live traffic, allowing automated monitors to detect and roll back bugs before they affect the general user base.

---

## 3. What Problem Does It Solve?
- **Connection Resets & 502 Bad Gateway Errors**: Prevents dropping active in-flight checkout transactions when backend containers are terminated.
- **Database Schema Incompatibility**: Resolves breaking database changes when old code and new code run concurrently using the **Expand/Contract (Parallel Run) Pattern**.
- **Human Verification Latency**: Automates canary analysis using real-time Prometheus error rate metrics rather than manual QA testing.

---

## 4. How Does It Work Internally?
1. **Graceful Termination Lifecycle**:
   - Kubernetes API sends `SIGTERM` to the container process.
   - Endpoint Controller concurrently removes the Pod IP from the Service endpoints list.
   - The application intercepts `SIGTERM`, stops accepting new connections, drains existing connections (up to `terminationGracePeriodSeconds: 30s`), closes DB pools, and cleanly exits.
2. **Readiness Probe Gating**:
   - New Pods are not added to the Service endpoint routing table until their readiness probes return HTTP 200.
3. **Traffic Splitting (Weighted Ingress)**:
   - Ingress-NGINX or AWS ALB splits traffic based on HTTP header cookies (`X-Canary: always`) or percentage weights (`nginx.ingress.kubernetes.io/canary-weight: "10"`).

---

## 5. Where Does It Fit in Our Architecture?
- **Microservices Deployment Strategy**: Standard RollingUpdate with `maxSurge: 25%` and `maxUnavailable: 0` for all 8 microservices.
- **Argo Rollouts / Canary**: Configured for high-risk checkout pathways (`order-service`, `payment-service`).
- **Database Migrations**: Backward-compatible expand/contract migrations executed via Flyway/Liquibase prior to Pod rollout.

---

## 6. How We Implemented It in This Project
### Argo Rollouts Canary Specification (`k8s/rollouts/order-service-canary.yaml`):

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: order-service
  namespace: production
spec:
  replicas: 4
  strategy:
    canary:
      canaryService: order-service-canary
      stableService: order-service-stable
      trafficRouting:
        nginx:
          stableIngress: order-service-ingress
      steps:
      - setWeight: 10
      - pause: { duration: 5m } # Wait 5 minutes and evaluate error rate
      - setWeight: 25
      - pause: { duration: 10m }
      - setWeight: 50
      - pause: { duration: 5m }
      analysis:
        templates:
        - templateName: success-rate-check
        args:
        - name: service-name
          value: order-service
```

---

## 7. Configuration Examples
### Graceful Shutdown in Express.js Backend (`shared/middleware/src/graceful-shutdown.ts`):
```typescript
import http from 'http';
import { Logger } from '@ecommerce/logger';

export function setupGracefulShutdown(server: http.Server, logger: Logger, cleanup?: () => Promise<void>) {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Initiating graceful shutdown...`);
    
    server.close(async () => {
      logger.info('HTTP server closed. Draining database & message queues...');
      if (cleanup) {
        await cleanup();
      }
      logger.info('Graceful shutdown completed. Process exiting cleanly.');
      process.exit(0);
    });

    // Hard kill after 25 seconds if graceful drain hangs
    setTimeout(() => {
      logger.error('Forcefully terminating process due to timeout.');
      process.exit(1);
    }, 25000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
```

---

## 8. Commands
```powershell
# Watch Argo Rollouts canary deployment progression in terminal
kubectl argo rollouts get rollout order-service -n production --watch

# Promote canary to 100% manually
kubectl argo rollouts promote order-service -n production

# Abort rollout instantly and restore 100% stable traffic
kubectl argo rollouts abort order-service -n production

# Undo / Rollback standard Kubernetes deployment
kubectl rollout undo deployment/order-service -n production
```

---

## 9. Verification
1. Run continuous traffic generator: `while ($true) { curl -s http://localhost:8000/api/v1/orders/health; Start-Sleep -Milliseconds 100 }`.
2. In a second terminal, execute `kubectl rollout restart deployment/order-service -n production`.
3. Verify that **0 errors (zero HTTP 502/503/connection drops)** occur during the entire rolling update.

---

## 10. Common Mistakes
1. **Ignoring `SIGTERM` in Application Code**: If Node.js doesn't catch `SIGTERM`, it terminates instantly, dropping every active database transaction and customer checkout in progress.
2. **Violating Database Expand/Contract Rules**: Renaming or dropping a database column in the same deployment that updates application code. Because old and new pods run simultaneously during the rolling update, the old pods crash when the column is dropped.
3. **Zero Pre-Stop Hook Delay in Fast Ingresses**: Kube-proxy and Ingress take 1–3 seconds to update iptables after Pod deletion. Old pods must pause for 2–5 seconds (`preStop: exec: command: ["sleep", "5"]`) before closing sockets.

---

## 11. Troubleshooting
- **Deployments Stuck in Progress**: A new Pod replica failed its readiness probe or is stuck in `CrashLoopBackOff`. Check `kubectl describe pod` and inspect readiness probe endpoints.
- **Canary Aborted Automatically**: Prometheus analysis metric detected HTTP 5xx error rate exceeded 1%. Argo Rollouts cleanly sets canary weight back to 0% without human intervention.

---

## 12. Security Best Practices
- **Automated Security Smoke Testing**: Run automated DAST security smoke tests against the Canary or Green deployment before switching 100% of user traffic.
- **Rollback Privilege Segregation**: Ensure deployment pipelines can execute rollbacks automatically without requiring manual elevated credentials.

---

## 13. Real-World Use Cases
- **Amazon & GitHub Continuous Deployment**: Engineers deploy code to production hundreds of times daily. GitHub uses automated canary analysis where internal employees test the new build (dogfooding) before rolling out to general public traffic.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: What is the Expand and Contract (Parallel Run) pattern for Zero-Downtime Database Migrations?
**Answer**:
When releasing breaking database changes without downtime:
1. **Phase 1 (Expand)**: Add the new column/table alongside the old one. Application code writes to both old and new columns, but reads from the old column.
2. **Phase 2 (Backfill)**: Run a background script to backfill data from old rows to new rows.
3. **Phase 3 (Switch)**: Deploy new code that reads from the new column and writes to both.
4. **Phase 4 (Contract)**: Deploy code that writes only to the new column, and safely drop the old column.
This ensures old and new Pods running concurrently during rolling updates never encounter schema errors.

### Q2: Why is a `preStop` sleep hook necessary in Kubernetes Pods?
**Answer**: When a Pod is terminated, two asynchronous events happen in parallel:
1. The Kubelet sends `SIGTERM` to the container.
2. The Endpoint Controller removes the Pod IP from the Service Endpoints list, which must then propagate to `kube-proxy` across every node and external Ingress controllers.
Because network propagation takes 1–3 seconds, external load balancers may continue forwarding new HTTP requests to the Pod *after* it received `SIGTERM`. Adding a `preStop: exec: command: ["sleep", "5"]` ensures the container keeps listening until all network routing tables have completed the Pod removal.

### Q3: When would an engineering team choose Blue/Green deployment over Canary deployment?
**Answer**:
- **Blue/Green**: Best when the application is stateful, involves complex batch jobs, or has breaking schema transformations that cannot run in parallel. It provides instant 100% rollback capability with a single router flip, but requires double the compute infrastructure.
- **Canary**: Best for high-traffic, stateless microservices platforms where you want to test performance, cache hit ratios, and error rates against real production traffic with minimal infrastructure overhead, containing the blast radius to a small fraction of users.
