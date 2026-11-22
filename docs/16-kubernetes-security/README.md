# Chapter 16: Advanced Kubernetes Security, RBAC & Hardening

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                               ENTERPRISE KUBERNETES DEFENSE-IN-DEPTH                      |
+───────────────────────────────────────────────────────────────────────────────────────────+
| [Layer 1: Identity & Access]  ────> AWS IAM + Kubernetes RBAC (Least Privilege Roles)     |
|                                                                                           |
| [Layer 2: Admission Control]  ────> Kyverno / OPA Gatekeeper (Policy Enforcement)         |
|                                     - Rejects images from non-ECR registries              |
|                                     - Rejects privileged or root containers               |
|                                                                                           |
| [Layer 3: Network Isolation]  ────> Kubernetes NetworkPolicies (Calico / AWS VPC CNI)     |
|                                     - Default Deny All Ingress/Egress                     |
|                                     - Frontend cannot talk directly to Databases          |
|                                                                                           |
| [Layer 4: Pod Hardening]      ────> Pod Security Standards: Restricted Profile            |
|                                     - readOnlyRootFilesystem: true                        |
|                                     - allowPrivilegeEscalation: false                     |
|                                     - drop: ["ALL"] capabilities                          |
|                                                                                           |
| [Layer 5: Runtime Auditing]   ────> Falco (eBPF Kernel Syscall Behavioral Monitoring)     |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
Kubernetes Security encompasses the architectural controls, identity policies, admission admission webhooks, network isolation boundaries, and runtime auditing tools that safeguard container workloads, sensitive data, and the underlying control plane against cyber attacks. It follows the **4C Model of Cloud-Native Security**: Cloud, Cluster, Container, and Code.

---

## 2. Why Do Companies Use It?
- **Multi-Tenant Isolation**: Ensures that a vulnerability in a public-facing service (like the frontend) cannot be leveraged by an attacker to traverse the cluster and compromise payment databases.
- **Compliance & Auditing**: Mandatory compliance with PCI-DSS, SOC 2 Type II, and ISO 27001 requires strict Role-Based Access Control (RBAC), encrypted secrets at rest, and immutable audit logs.
- **Zero-Trust Networking**: Microservices must never trust each other merely because they reside inside the same VPC or Kubernetes cluster.

---

## 3. What Problem Does It Solve?
- **Container Breakouts**: Prevents compromised container processes from escaping their namespaces into the host Linux kernel (root escalation).
- **Lateral Movement**: Blocks unauthorized East-West traffic between Pods using zero-trust NetworkPolicies.
- **Accidental Cluster Destruction**: RBAC stops unauthorized developers from deleting production namespaces or modifying secrets.

---

## 4. How Does It Work Internally?
1. **Admission Controller Webhooks**:
   - `MutatingAdmissionWebhook`: Automatically injects security contexts, sidecars, or environment variables before objects are saved to `etcd`.
   - `ValidatingAdmissionWebhook` (e.g. Kyverno): Validates incoming YAML against corporate security policies, rejecting non-compliant manifests before execution.
2. **NetworkPolicies**:
   - Implemented via the CNI plugin (Calico, Cilium, or AWS VPC CNI). Translates declared label selectors into kernel `iptables` or eBPF bytecode rules on each worker node.
3. **Pod Security Standards (PSS)**:
   - Built directly into Kubernetes 1.25+. Enforces three levels: `Privileged`, `Baseline`, and `Restricted` via namespace labels.

---

## 5. Where Does It Fit in Our Architecture?
- **Namespace Hardening**: Production namespaces labeled with `pod-security.kubernetes.io/enforce: restricted`.
- **Default-Deny Network Policies**: Applied to `production` namespace; only explicitly authorized service-to-service communication is allowed.
- **IRSA (IAM Roles for Service Accounts)**: Each microservice has an isolated Kubernetes ServiceAccount mapping to a fine-grained AWS IAM role.
- **KMS Secrets Encryption**: All Kubernetes Secrets in `etcd` are encrypted at rest using an AWS KMS Customer Managed Key (CMK).

---

## 6. How We Implemented It in This Project
### 1. Default-Deny & Microservice Isolation NetworkPolicy (`k8s/security/network-policy.yaml`):

```yaml
# 1. Deny all East-West traffic by default in production
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: production
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
---
# 2. Allow API Gateway to route to Order Service only
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-gateway-to-order
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: order-service
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: api-gateway
    ports:
    - protocol: TCP
      port: 5004
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: postgres
    ports:
    - protocol: TCP
      port: 5432
  - to:
    - podSelector:
        matchLabels:
          app: rabbitmq
    ports:
    - protocol: TCP
      port: 5672
  - to:
    - namespaceSelector: {}
      podSelector:
        matchLabels:
          k8s-app: kube-dns
    ports:
    - protocol: UDP
      port: 53
```

---

## 7. Configuration Examples
### Enforcing Pod Security Standards on Namespace:
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

---

## 8. Commands
```powershell
# Verify Pod Security violations in a namespace
kubectl label --overwrite namespace production pod-security.kubernetes.io/enforce=restricted --dry-run=server

# Audit active NetworkPolicies in production namespace
kubectl get networkpolicies -n production

# Test connectivity between pods using ephemeral netshoot container
kubectl run test-net --rm -it --image=nicolaka/netshoot -n production -- curl -v --connect-timeout 2 http://order-service:5004/health

# Verify API server audit logging is enabled
kubectl get validatingwebhookconfigurations
```

---

## 9. Verification
1. Attempt to launch an insecure pod with `securityContext: privileged: true` in the `production` namespace.
2. Confirm the Kubernetes API server rejects the pod with: `Error from server (Forbidden): pods "insecure-pod" is forbidden: violates PodSecurity "restricted:latest": privileged (container "test" must not set securityContext.privileged=true)`.
3. Verify that a pod without an explicit egress NetworkPolicy cannot connect to the internet or outside services.

---

## 10. Common Mistakes
1. **Missing Default-Deny NetworkPolicy**: In vanilla Kubernetes, all pods can talk to all pods across all namespaces by default (flat network).
2. **Mounting Root ServiceAccount Tokens**: Every pod mounts `/var/run/secrets/kubernetes.io/serviceaccount/token` by default. If compromised, an attacker queries the Kube-APIServer. Set `automountServiceAccountToken: false` on pods that do not interact with the Kubernetes API.
3. **Granting Wildcard (`*`) ClusterRole Permissions**: Giving `*` verbs on `*` resources to CI/CD service accounts creates massive privilege escalation risks.

---

## 11. Troubleshooting
- **Pods Cannot Resolve DNS After Applying NetworkPolicy**: The pod's egress policy blocked UDP port 53 to `kube-dns` in `kube-system`. Always add an explicit egress rule for CoreDNS.
- **Pod Evicted with `ReadOnlyFilesystem` Error**: Application attempted to write logs or temp files to disk. Mount an `emptyDir` volume at `/tmp` for ephemeral temporary files.

---

## 12. Security Best Practices
- **Enable AWS KMS Envelope Encryption for etcd**: Ensures raw secret values stored on etcd disk are fully encrypted with a rotating KMS key.
- **Runtime Threat Detection with Falco**: Monitor Linux kernel syscalls via eBPF to detect interactive shell spawns (`sh` inside container), unauthorized file writes to `/etc`, or outbound SSH connections.
- **Regular RBAC Auditing**: Use tools like `rakkess` to audit cluster role bindings.

---

## 13. Real-World Use Cases
- **Tesla / Financial Kubernetes Security Incident**: In 2018, attackers compromised an unsecured Kubernetes dashboard lacking RBAC and authentication, gained access to AWS credentials, and launched cryptocurrency miners across enterprise nodes. Modern Pod Security Standards and strict RBAC completely prevent this vector.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: What is the difference between Kubernetes RBAC Role and ClusterRole?
**Answer**:
- **Role**: Namespaced. Grants permissions (API groups, resources, verbs) strictly within a single specific namespace (e.g., read pods in `staging`).
- **ClusterRole**: Non-namespaced (Cluster-scoped). Grants permissions across all namespaces in the cluster (e.g., node management, storage classes, CRDs) or defines reusable permission sets that can be bound to specific namespaces via a `RoleBinding`.

### Q2: How do Pod Security Standards (PSS) replace deprecated Pod Security Policies (PSP)?
**Answer**: Pod Security Policies (PSPs) were complex, order-dependent, and prone to breaking clusters upon upgrade. Kubernetes 1.25+ replaced them with built-in Pod Security Standards (Privileged, Baseline, Restricted) enforced via namespace labels. The API server evaluates incoming Pods at admission time and natively enforces strict controls (such as disallowing root, requiring read-only root filesystems, and dropping capabilities) without requiring third-party admission controllers.

### Q3: How do NetworkPolicies work under the hood in Kubernetes?
**Answer**: NetworkPolicies are declarative Kubernetes specifications. The core Kubernetes API does not enforce them; the underlying CNI plugin (such as Calico, Cilium, or AWS VPC CNI with Network Policy agent) watches the Kubernetes API for NetworkPolicy objects. The CNI daemon translates those rules into Linux kernel packet-filtering primitives—either Linux kernel `iptables` / `ipset` chains or modern eBPF maps—intercepting and dropping packets at the network interface level.
