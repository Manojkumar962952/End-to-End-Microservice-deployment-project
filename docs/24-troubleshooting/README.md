# Chapter 24: Production Troubleshooting, Root Cause Analysis (RCA) & Debugging

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                               SRE SYSTEMATIC DEBUGGING METHODOLOGY                        |
+───────────────────────────────────────────────────────────────────────────────────────────+
|  [Alert Fires: High p99 Latency / 5xx Spike on /orders]                                   |
|         │                                                                                 |
|         ▼ Phase 1: Triage & Impact Assessment (Is customer checkout blocked?)             |
|  [Check 4 Golden Signals: Traffic, Errors, Latency, Saturation]                           |
|         │                                                                                 |
|         ▼ Phase 2: Isolation (Eliminate layers from outside in)                           |
|  [DNS / ALB] ──> [Ingress Controller] ──> [API Gateway] ──> [Pod Service] ──> [DB/MQ]     |
|         │                                                                                 |
|         ▼ Phase 3: Investigation (Logs, Traces & Kernel State)                            |
|  • Correlate `x-correlation-id` in Loki & OpenTelemetry Waterfall Traces                 |
|  • Inspect Kubernetes Events: `kubectl describe pod` (OOMKilled? Evicted?)                |
|  • Check Node Resource Contention: `top`, `vmstat`, `iostat`, `netstat`                   |
|         │                                                                                 |
|         ▼ Phase 4: Remediation (Mitigate first, debug deeply later)                       |
|  • Roll back bad deployment / scale pod replicas / fail over database replica             |
|         │                                                                                 |
|         ▼ Phase 5: Blameless Post-Mortem & 5 Whys Analysis                                |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
Production Troubleshooting and Root Cause Analysis (RCA) is the systematic, hypothesis-driven engineering methodology used by Site Reliability Engineers (SREs) and DevOps architects to diagnose, mitigate, and permanently eliminate failures across distributed microservices, container runtimes, networks, and cloud infrastructure.

---

## 2. Why Do Companies Prioritize It?
- **Minimizing MTTR (Mean Time to Recovery)**: Unplanned downtime directly reduces gross merchandise value (GMV), triggers SLA breach penalties, and damages customer trust.
- **Blameless Culture & Continuous Improvement**: Focuses on systemic and architectural improvements rather than human blame, transforming every production incident into automated safeguards.
- **Preventing Repeat Incidents**: Ensures the exact same failure mode never recurs in production.

---

## 3. What Problem Does It Solve?
- **"Shotgun" Debugging**: Eliminates chaotic, trial-and-error changes made under high pressure that often exacerbate outages.
- **Heisenbugs**: Identifies elusive bugs that disappear when observed, such as race conditions during inventory reservation or connection pool exhaustion under load.
- **Cascading Failures**: Uncovers hidden synchronous dependencies that cause unrelated services to fail when a single downstream component degrades.

---

## 4. How Does It Work Internally?
1. **The USE Method (Brendan Gregg)**:
   - For every hardware and virtual resource (CPU, Memory, Disk I/O, Network Sockets), check: **Utilization** (percentage in use), **Saturation** (queue length / waiting tasks), and **Errors** (failed operations).
2. **The 5 Whys Technique**:
   - Iteratively interrogates cause-and-effect relationships:
     *Why did the checkout fail?* $\rightarrow$ DB connection timeout.
     *Why did it timeout?* $\rightarrow$ Connection pool was exhausted.
     *Why was it exhausted?* $\rightarrow$ A slow unindexed query held connections for 4 seconds.
     *Why was the query slow?* $\rightarrow$ A missing index on `orders.customer_id`.
     *Why was the index missing?* $\rightarrow$ Database migration was not reviewed against the query performance checklist.
3. **Linux Kernel Observability**:
   - Uses tools like `strace`, `lsof`, `tcpdump`, and eBPF (`bcc`, `bpftrace`) to inspect process system calls directly at the kernel interface.

---

## 5. Where Does It Fit in Our Architecture?
- **Observability Stack**: Prometheus metrics, Loki logs, and Tempo traces provide the primary diagnostic telemetry.
- **Kubernetes Ephemeral Debug Containers**: Injected into failing Pods to inspect network sockets and filesystems without restarting containers.
- **Health Probes**: Liveness and readiness endpoints report granular component status.

---

## 6. How We Implemented It in This Project
### Linux & Kubernetes Debugging Cheatsheet:

| Symptom | Diagnostic Tool | Primary Command | Root Cause Indicator |
| :--- | :--- | :--- | :--- |
| **High CPU Usage** | `top`, `pidstat` | `pidstat -u 1 5` | Node.js event loop blocking or CPU throttling (`cgroups`) |
| **Memory Leak** | `node --inspect`, `heapdump` | `kubectl exec -it <pod> -- node -e 'process.memoryUsage()'` | Unbounded cache or event listener leak |
| **Socket Starvation** | `netstat`, `ss` | `ss -s` or `netstat -an | grep TIME_WAIT | wc -l` | Ephemeral port exhaustion / missing HTTP keep-alive |
| **Database Contention**| `pg_stat_activity` | `SELECT pid, query, age(clock_timestamp(), query_start) FROM pg_stat_activity WHERE state != 'idle';` | Long-running row lock in `SELECT ... FOR UPDATE` |
| **Packet Drops** | `tcpdump`, `curl` | `tcpdump -nn -i any port 5004` | MTU mismatch or dropped SYN packets |

---

## 7. Configuration Examples
### Ephemeral Kubernetes Debug Container Injection:
```powershell
# Attach an interactive ephemeral debug container with network tools to a running distroless Pod
kubectl debug -it order-service-6789b-xxxx --image=nicolaka/netshoot --target=order-service -n production
```

---

## 8. Commands
```powershell
# Inspect recent Kubernetes events sorted by timestamp
kubectl get events -n production --sort-by='.metadata.creationTimestamp'

# Check why Pod was terminated
kubectl get pod <pod-name> -n production -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}'

# Live packet trace on internal bridge network
docker exec -it ecommerce-api-gateway tcpdump -nn -v -c 10 port 5004

# Inspect open file descriptors of a process
ls -l /proc/<PID>/fd | wc -l
```

---

## 9. Verification
1. Induce an artificial incident (e.g., stop the PostgreSQL container: `docker stop ecommerce-postgres`).
2. Follow the diagnostic playbook:
   - Check API Gateway logs $\rightarrow$ HTTP 500 returned with message `Database connection timeout`.
   - Check Order Service health probe $\rightarrow$ `/health` reports `unhealthy`.
   - Restore database: `docker start ecommerce-postgres`.
   - Verify connection pool auto-recovers and orders resume without container restarts.

---

## 10. Common Mistakes
1. **Restarting Services Before Collecting Forensics**: Restarting a leaking Node.js process destroys in-memory heap state and core dumps, making root-cause diagnosis impossible. Capture heap snapshots before killing the process.
2. **Confusing Symptoms with Root Causes**: Adding more RAM to a node experiencing an out-of-memory error caused by an unbounded JavaScript array memory leak. It only delays the next crash.
3. **Blaming Third Parties Without Evidence**: Assuming AWS or the payment gateway had an outage without checking TCP handshake metrics or response error codes.

---

## 11. Troubleshooting
- **Pod Stuck in `Terminating` State**: Often caused by unresponsive NFS/EBS volume unmounts or ignoring `SIGKILL`. Force terminate with `kubectl delete pod <pod-name> --grace-period=0 --force` (use with caution).
- **Intermittent DNS Lookup Failures in Kubernetes**: Caused by Linux kernel `conntrack` race conditions in older kernels. Upgrade CoreDNS and enable NodeLocal DNSCache.

---

## 12. Security Best Practices
- **Never Debug with Production Customer Data Locally**: Anonymize database dumps before copying them to developer workstations for debugging.
- **Audit Break-Glass SSH Sessions**: Require approval and full session recording (via AWS Systems Manager Session Manager or Teleport) when engineers access production containers.

---

## 13. Real-World Use Cases
- **Cloudflare 2019 Regular Expression Outage**: A single catastrophic backtracking regex in a WAF rule caused 100% CPU exhaustion across Cloudflare's global edge nodes. SREs used CPU profiling flame graphs to locate the offending regex within 30 minutes and deploy a kill switch.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: Walk me through your troubleshooting process when an API endpoint suddenly starts returning HTTP 504 Gateway Timeout.
**Answer**:
1. **Clarify Scope**: Is it affecting all endpoints or only `/orders`? Is it affecting all users or a subset?
2. **Trace Request Path**: A 504 Gateway Timeout means an intermediate proxy (ALB, NGINX Ingress, or API Gateway) waited for a response from an upstream backend service, but the upstream didn't reply before the proxy timeout expired.
3. **Inspect Upstream Health**: Look at upstream service metrics (Order Service). Is the container CPU at 100% (event loop blocked)? Is it waiting on a downstream dependency?
4. **Inspect Dependencies**: Query database active connections (`pg_stat_activity`) and message broker queue depths. Check if the database has locks (`SELECT ... FOR UPDATE` row contention) or connection pool exhaustion.
5. **Mitigate**: If caused by a bad recent deployment, rollback immediately. If caused by load, scale replicas or enable circuit breaker shedding.

### Q2: What is the difference between `iowait`, `system`, and `user` CPU time in `top`?
**Answer**:
- `us` (User): Percentage of CPU time spent executing unprivileged user-space processes (Node.js code, business logic).
- `sy` (System): Percentage of CPU time spent executing kernel-space code (handling system calls, context switching, network socket operations). High `sy` often indicates excessive thread creation or network I/O.
- `wa` (IOwait): Percentage of CPU time during which the CPU was idle while waiting for an outstanding disk I/O or network file system operation to complete. High `wa` points directly to disk bottlenecks (e.g. slow EBS volumes, database write saturation).

### Q3: How do you identify a memory leak in a Node.js microservice running in production?
**Answer**:
1. **Metrics**: Observe the Prometheus `process_resident_memory_bytes` metric. A classic sawtooth pattern with a continuously rising baseline across garbage collection cycles indicates a leak.
2. **Heap Profiling**: Connect to the running container using Chrome DevTools via `node --inspect` or trigger a heap snapshot using `v8.writeHeapSnapshot()`.
3. **Diff Analysis**: Take two heap snapshots 15 minutes apart. Compare the snapshots in Chrome DevTools to identify retained objects with growing instance counts (frequently unclosed event listeners, global cache objects, or uncompleted closure references).
