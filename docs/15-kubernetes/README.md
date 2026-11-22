# Chapter 15: Enterprise Kubernetes Cluster Architecture & Workloads

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                               ENTERPRISE KUBERNETES POD ARCHITECTURE                      |
+───────────────────────────────────────────────────────────────────────────────────────────+
| [Client Request] ──> [AWS ALB / Ingress-NGINX Controller]                                 |
|                               │                                                           |
|                               ▼ (ClusterIP Service: kube-proxy iptables / IPVS routing)   |
| [Pod Replica 1] ────────────────────────────────────────────────────────────────────────  |
| ┌───────────────────────────────────────────────────────────────────────────────────────┐ |
| │ Pod IP: 10.0.10.45 (AWS VPC CNI ENI IP)                                               │ |
| │                                                                                       │ |
| │ [Container: order-service]                                                            │ |
| │ - Non-root UID: 1000 (`USER node`)                                                    │ |
| │ - Probes:                                                                             │ |
| │   • Startup Probe:   `/health` (FailureThreshold: 30, Period: 2s)                      │ |
| │   • Liveness Probe:  `/health` (InitialDelay: 5s, Period: 10s)                        │ |
| │   • Readiness Probe: `/ready`  (Period: 5s -> Ingress routes only when OK)            │ |
| │ - Resources:                                                                          │ |
| │   • Requests: CPU: 100m, Memory: 128Mi (Guaranteed QoS allocation)                    │ |
| │   • Limits:   CPU: 500m, Memory: 256Mi (Prevents node exhaustion)                     │ |
| │ - Config: Injected via ConfigMaps & Secrets (IRSA IAM Auth)                           │ |
| └───────────────────────────────────────────────────────────────────────────────────────┘ |
|                               ▲                                                           |
| [Horizontal Pod Autoscaler (HPA)] -> Scales 2 to 10 Pods based on CPU > 70% or QPS      |
| [Pod Disruption Budget (PDB)]    -> Enforces minAvailable: 1 during cluster upgrades     |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
Kubernetes (K8s) is an open-source container orchestration platform designed to automate deploying, scaling, self-healing, and operating containerized applications across clusters of physical or virtual compute nodes.

---

## 2. Why Do Companies Use It?
- **Self-Healing & High Availability**: Automatically replaces and reschedules containers that crash, fail health probes, or die due to underlying hardware node failure.
- **Horizontal Elasticity**: Scales microservice Pod replicas dynamically up and down in response to real-time CPU, memory, or business metrics (e.g., RabbitMQ queue backlog).
- **Zero-Downtime Deployments**: Executes gradual rolling updates, canary rollouts, and blue-green traffic switching without dropping incoming customer requests.

---

## 3. What Problem Does It Solve?
- **Manual Node Management**: Eliminates the need for SREs to SSH into individual VMs to start processes or restart failed services.
- **Cascading Failures**: Implements circuit breaking, Pod Disruption Budgets (PDB), and isolated resource limits preventing one rogue microservice from exhausting cluster memory.
- **Service Discovery Complexity**: Provides built-in internal DNS (`CoreDNS`) and virtual IP routing (`ClusterIP`) across thousands of ephemeral containers.

---

## 4. How Does It Work Internally?
1. **Control Plane**:
   - `kube-apiserver`: Exposes REST API; the only component that communicates directly with `etcd`.
   - `etcd`: Distributed, highly consistent key-value store for cluster state.
   - `kube-scheduler`: Assigns newly created Pods to optimal worker nodes based on resource requests, affinity, and taints/tolerations.
   - `kube-controller-manager`: Runs reconciliation loops (DeploymentController, NodeController).
2. **Worker Nodes**:
   - `kubelet`: Node agent that registers the node with the API server and instructs the container runtime (containerd) to start/stop Pod containers.
   - `kube-proxy`: Manages iptables or IPVS network rules on each node to forward traffic sent to Service Virtual IPs directly to backend Pod IPs.
   - `containerd`: Low-level OCI container runtime.

---

## 5. Where Does It Fit in Our Architecture?
Kubernetes orchestrates all production workloads across our `ap-south-1` EKS cluster:
- **Deployments**: 8 backend microservices (`api-gateway`, `order-service`, etc.) and frontend SPA.
- **Services**: Internal `ClusterIP` services for each microservice.
- **Ingress**: `Ingress-NGINX` routing public internet traffic from AWS ALB to the API Gateway and Frontend.
- **Autoscaling**: HPA and Pod Disruption Budgets configured for every service.

---

## 6. How We Implemented It in This Project
Production Deployment manifest (`k8s/base/order-service-deployment.yaml`):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  namespace: production
  labels:
    app.kubernetes.io/name: order-service
    app.kubernetes.io/part-of: ecommerce-platform
spec:
  replicas: 2
  revisionHistoryLimit: 5
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%
      maxUnavailable: 0
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
    spec:
      serviceAccountName: order-service-sa
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
      containers:
      - name: order-service
        image: 123456789012.dkr.ecr.ap-south-1.amazonaws.com/ecommerce-order-service:sha-f1d3770
        imagePullPolicy: IfNotPresent
        ports:
        - containerPort: 5004
          name: http
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 500m
            memory: 256Mi
        startupProbe:
          httpGet:
            path: /health
            port: 5004
          failureThreshold: 30
          periodSeconds: 2
        livenessProbe:
          httpGet:
            path: /health
            port: 5004
          initialDelaySeconds: 5
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 5004
          periodSeconds: 5
        envFrom:
        - configMapRef:
            name: order-service-config
        - secretRef:
            name: order-service-secrets
```

---

## 7. Configuration Examples
### Horizontal Pod Autoscaler (HPA) & Pod Disruption Budget (PDB)
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: order-service-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: order-service
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: order-service-pdb
  namespace: production
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: order-service
```

---

## 8. Commands
```powershell
# Get status of all Pods, Services, and Deployments in production namespace
kubectl get all -n production -o wide

# Follow real-time streaming logs across all replicas of a deployment
kubectl logs -f -n production -l app=order-service --tail=100

# Inspect why a Pod is in CrashLoopBackOff or Pending state
kubectl describe pod <pod-name> -n production

# Execute a zero-downtime rolling restart of a deployment
kubectl rollout restart deployment/order-service -n production

# Check rollout progression and status
kubectl rollout status deployment/order-service -n production

# Instant rollback to previous deployment revision
kubectl rollout undo deployment/order-service -n production
```

---

## 9. Verification
1. Run `kubectl get pods -n production`. Verify all pods show `Running` with `1/1` READY.
2. Simulate a pod crash: `kubectl delete pod <pod-name> -n production`.
3. Verify Kubernetes immediately spins up a replacement pod within 2 seconds without dropping any incoming customer requests.

---

## 10. Common Mistakes
1. **Omitting Resource Requests & Limits**: Pods without requests are classified as `BestEffort` QoS. Under node memory pressure, the Linux kernel kills `BestEffort` pods first.
2. **Identical Liveness and Readiness Probes**: If the database goes down, a naive liveness probe that checks DB connectivity will fail and cause Kubernetes to restart all pods in a loop, worsening the outage. Liveness probes should only check process health; readiness probes should check external dependencies.
3. **Setting `maxUnavailable: 100%` during Rolling Updates**: Causes Kubernetes to terminate all existing pods before new pods are ready, creating complete service downtime. Set `maxUnavailable: 0` and `maxSurge: 25%`.

---

## 11. Troubleshooting
- **`CrashLoopBackOff`**: Application process crashed immediately after starting. Inspect crash logs with `kubectl logs <pod> --previous`.
- **`OOMKilled` (Exit Code 137)**: Container exceeded its memory limit. Inspect `kubectl describe pod` for `Last State: Terminated, Reason: OOMKilled` and increase `resources.limits.memory`.
- **`Pending` Pod**: Scheduler cannot find a node with enough available CPU/memory requests. Scale node group or reduce resource requests.

---

## 12. Security Best Practices
- **Never Run as Root**: Enforce `runAsNonRoot: true` in Pod security context.
- **Read-Only Root Filesystem**: Set `readOnlyRootFilesystem: true` to prevent persistent disk tampering by attackers.
- **Drop Linux Capabilities**: Add `capabilities: drop: ["ALL"]`.

---

## 13. Real-World Use Cases
- **High-Frequency Flash Sales**: During Black Friday, e-commerce platforms automatically scale order and inventory microservice pods from 5 replicas to 150 replicas within 3 minutes based on incoming HTTP request rate metrics.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: What is the exact difference between Liveness, Readiness, and Startup Probes?
**Answer**:
- **Startup Probe**: Runs first when the container boots. While running, it disables liveness and readiness checks, allowing legacy or slow-booting applications up to several minutes to initialize without being killed.
- **Liveness Probe**: Determines if the container process is alive and healthy. If it fails `failureThreshold` times, Kubelet terminates the container process and restarts it according to the restartPolicy.
- **Readiness Probe**: Determines if the container is ready to accept user network traffic. If it fails, Kubelet removes the Pod's IP from all Service endpoints and Ingress routing tables; the container is NOT restarted.

### Q2: How does Kubernetes achieve zero-downtime rolling updates without dropping in-flight HTTP connections?
**Answer**:
1. When a new deployment revision is applied, Kubernetes spins up new Pods according to `maxSurge`.
2. New Pods execute their Startup and Readiness Probes. Traffic is NOT routed to them until they pass.
3. Once ready, Kubernetes issues a `SIGTERM` signal to old Pods and concurrently removes their IPs from the Service endpoints.
4. Old Pods execute graceful shutdown handlers (`server.close()`), completing existing in-flight HTTP transactions while rejecting new ones.
5. If processes don't exit within `terminationGracePeriodSeconds` (default 30s), Kubelet sends `SIGKILL`.

### Q3: What is the difference between CPU Requests and CPU Limits in the Linux kernel?
**Answer**: CPU Requests are implemented via CFS (Completely Fair Scheduler) **shares** (`cpu.shares` in cgroups), guaranteeing a minimum proportion of CPU time when the node is under contention. CPU Limits are implemented via CFS **quota and period** (`cpu.cfs_quota_us` and `cpu.cfs_period_us`). If a container exceeds its CPU limit within a 100ms period, the Linux kernel **throttles** its CPU cycles (introducing latency) rather than killing the process (unlike memory limits, which trigger OOMKilled).
