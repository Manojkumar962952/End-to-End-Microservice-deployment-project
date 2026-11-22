# Chapter 19: Enterprise DNS, TLS 1.3, SSL Termination & Cert-Manager

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                               ENTERPRISE DNS & TLS 1.3 TRAFFIC FLOW                       |
+───────────────────────────────────────────────────────────────────────────────────────────+
| [Client Browser: https://ecommerce.com]                                                   |
|         │                                                                                 |
|         ├── 1. Amazon Route 53 (Anycast Global DNS Resolution) -> Latency/Geo Routing     |
|         ▼                                                                                 |
| [AWS CloudFront / Application Load Balancer] ───────────────────────────────────────────  |
| ┌───────────────────────────────────────────────────────────────────────────────────────┐ |
| │ AWS Certificate Manager (ACM) Public Certificate (*.ecommerce.com)                   │ |
| │ - 2048-bit RSA / ECDSA P-256                                                          │ |
| │ - TLS 1.3 Cipher Suites (TLS_AES_128_GCM_SHA256, TLS_CHACHA20_POLY1305_SHA256)        │ |
| │ - HTTP -> HTTPS Strict Redirection (HSTS: max-age=31536000; includeSubDomains)        │ |
| │ - Public SSL Termination at the Edge                                                  │ |
| └───────────────────────────────────────────────────────────────────────────────────────┘ |
|         │                                                                                 |
|         ▼ (Mutual TLS / Encrypted Internal Pod Traffic)                                   |
| [cert-manager in Amazon EKS Cluster]                                                      |
| - Automated Let's Encrypt / Vault Private CA Issuance                                    |
| - Automatic 60-day Certificate Renewal Loops                                              |
| - In-cluster Pod-to-Pod mTLS Encryption via Istio / Linkerd Service Mesh                  |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
DNS (Domain Name System) translates human-readable domain names (e.g., `api.ecommerce.com`) into routable IP addresses. TLS (Transport Layer Security) 1.3 is the modern cryptographic protocol designed to provide privacy, integrity, and data authentication between communicating computer applications over the internet.

---

## 2. Why Do Companies Use It?
- **Protection Against Eavesdropping & MitM Attacks**: Encrypts credit card payloads, passwords, and PII in transit.
- **Brand Trust & Search Ranking**: Browsers mark unencrypted HTTP sites as "Not Secure", hurting conversion and Google search rankings.
- **Latency Improvements in TLS 1.3**: Reduces cryptographic handshake overhead from two round trips ($2$-RTT in TLS 1.2) to a single round trip ($1$-RTT or $0$-RTT session resumption).

---

## 3. What Problem Does It Solve?
- **Certificate Expiration Outages**: Companies lose millions when engineers forget to renew SSL certificates. Automated certificate controllers (**cert-manager** and AWS ACM) eliminate human error.
- **DNS Failover Latency**: Route 53 health-checked failover routing flips traffic to a secondary region within 60 seconds of a disaster.
- **Downgrade Attacks**: Strict Transport Security (HSTS) prevents attackers from stripping SSL via SSL-stripping proxies.

---

## 4. How Does It Work Internally?
1. **Route 53 DNS Resolution**:
   - Client resolves `api.ecommerce.com` using recursive resolvers that query Route 53 Anycast name servers.
   - Route 53 responds with an `ALIAS` record pointing directly to the AWS Application Load Balancer DNS name with zero DNS hop penalty.
2. **TLS 1.3 Handshake Protocol**:
   - **ClientHello**: Sends supported ciphers, Diffie-Hellman key share ($g^x \pmod p$), and Server Name Indication (SNI).
   - **ServerHello**: Server responds with its key share ($g^y \pmod p$), sends its X.509 certificate, computes symmetric master secrets, and finishes the handshake. Application data encryption begins immediately after $1$-RTT.
3. **cert-manager Reconcile Loop**:
   - Watches `Certificate` CRDs in Kubernetes.
   - Executes ACME HTTP-01 or DNS-01 challenges against Let's Encrypt or Route 53.
   - Rotates secrets automatically 30 days before expiration.

---

## 5. Where Does It Fit in Our Architecture?
- **Public Edge**: Route 53 routes `api.ecommerce.com` to the AWS ALB.
- **Edge Termination**: AWS ACM provisions and attaches public wild-card SSL certificates (`*.ecommerce.com`) to the ALB on port 443 with automated HTTP-to-HTTPS redirect.
- **Internal Cluster**: Ingress-NGINX and `cert-manager` manage internal namespace ingress TLS certificates.

---

## 6. How We Implemented It in This Project
### Cert-Manager ClusterIssuer & Certificate Resource (`k8s/tls/cert-manager-issuer.yaml`):

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-production
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: devops-alerts@ecommerce.com
    privateKeySecretRef:
      name: letsencrypt-prod-account-key
    solvers:
    - http01:
        ingress:
          class: nginx
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: ecommerce-api-tls
  namespace: production
spec:
  secretName: ecommerce-api-tls-cert
  issuerRef:
    name: letsencrypt-production
    kind: ClusterIssuer
  commonName: api.ecommerce.com
  dnsNames:
  - api.ecommerce.com
  renewBefore: 720h # 30 days before expiration
```

---

## 7. Configuration Examples
### HSTS & TLS 1.3 Security Headers in NGINX Ingress:
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  namespace: production
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-production
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/ssl-protocols: "TLSv1.3"
    nginx.ingress.kubernetes.io/configuration-snippet: |
      more_set_headers "Strict-Transport-Security: max-age=31536000; includeSubDomains; preload";
      more_set_headers "X-Frame-Options: DENY";
      more_set_headers "X-Content-Type-Options: nosniff";
spec:
  tls:
  - hosts:
    - api.ecommerce.com
    secretName: ecommerce-api-tls-cert
  rules:
  - host: api.ecommerce.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api-gateway
            port:
              number: 8000
```

---

## 8. Commands
```powershell
# Inspect TLS certificate expiration date and cipher suite via OpenSSL
openssl s_client -connect api.ecommerce.com:443 -servername api.ecommerce.com -tls1_3

# Verify cert-manager certificate issuance status in Kubernetes
kubectl get certificate -n production
kubectl describe certificate ecommerce-api-tls -n production

# Test DNS propagation and TTL using dig/nslookup
nslookup api.ecommerce.com 8.8.8.8
```

---

## 9. Verification
1. Access `http://api.ecommerce.com` using `curl -I`. Verify that response status is `301 Moved Permanently` redirecting to `https://api.ecommerce.com`.
2. Inspect SSL Labs grade: Run SSL Labs test against domain; verify an **A+** rating (TLS 1.3, HSTS enabled, weak CBC ciphers disabled).
3. Verify certificate auto-renewal: Check cert-manager logs for successful ACME challenge completion.

---

## 10. Common Mistakes
1. **Letting Certificates Expire**: Forgetting to automate renewal or monitoring. Set up Prometheus Alertmanager alerts when `cert_exporter` reports expiration `< 14 days`.
2. **Missing Intermediate Certificates in SSL Bundles**: Serving only the leaf certificate causes older Android or Java clients to throw `SSLHandshakeException: PKIX path building failed`.
3. **Hardcoding DNS Caches in Java/Node**: By default, older runtimes cache DNS responses forever. Configure Node.js / JVM DNS TTL to 60 seconds (`networkaddress.cache.ttl=60`).

---

## 11. Troubleshooting
- **Error: ACME Challenge Failed (HTTP-01)**: Let's Encrypt servers could not reach `http://api.ecommerce.com/.well-known/acme-challenge/...`. Verify that port 80 is open and not blocked by AWS WAF or security groups.
- **Mixed Content Warnings in Browser**: Frontend loaded over HTTPS makes calls to backend APIs using `http://`. Always use relative paths or strict HTTPS URLs.

---

## 12. Security Best Practices
- **Enforce TLS 1.3 (or 1.2 Minimum)**: Completely disable insecure legacy protocols (SSLv3, TLS 1.0, TLS 1.1) and deprecated 3DES/RC4 ciphers.
- **Enable HSTS Preloading**: Submit domain to `hstspreload.org` so browsers refuse unencrypted HTTP connections unconditionally.
- **Implement CAA DNS Records**: Specify in Route 53 which Certificate Authorities (e.g., `amazon.com`, `letsencrypt.org`) are legally permitted to issue certificates for your domain.

---

## 13. Real-World Use Cases
- **Global Anycast Latency Routing**: Netflix and Cloudflare use Route 53 Geolocation and Latency-based DNS routing to direct user requests to the geographically nearest AWS region, minimizing round-trip time.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: What makes TLS 1.3 significantly faster and more secure than TLS 1.2?
**Answer**:
1. **Speed ($1$-RTT vs $2$-RTT)**: TLS 1.2 required two full round-trips to negotiate ciphers and complete the Diffie-Hellman key exchange before application data could be sent. TLS 1.3 bundles the key share directly into the `ClientHello`, completing the handshake in a single round-trip ($1$-RTT), and supports $0$-RTT (Zero Round Trip Time) for returning visitors.
2. **Security**: TLS 1.3 completely removed vulnerable legacy features: RSA key transport (which lacked Perfect Forward Secrecy), CBC mode ciphers, RC4, MD5, SHA-1, and insecure renegotiation, leaving only AEAD (Authenticated Encryption with Associated Data) ciphers like AES-GCM and ChaCha20-Poly1305.

### Q2: What is the difference between Route 53 CNAME and ALIAS records?
**Answer**:
- **CNAME (Canonical Name)**: Maps one domain name to another domain name. Per RFC 1034, a CNAME cannot be created at the zone apex (`ecommerce.com`). Each CNAME lookup requires an additional recursive DNS query, adding latency.
- **ALIAS (Route 53 Specific)**: A virtual record type created by AWS that maps the zone apex or subdomain directly to AWS resources (ALBs, CloudFront distributions, S3 website endpoints). Route 53 automatically resolves the alias internally to the AWS resource's IP address with zero additional DNS hops, and ALIAS records can be safely created at the zone apex.

### Q3: How does ACME DNS-01 challenge differ from HTTP-01 challenge in cert-manager?
**Answer**:
- **HTTP-01 Challenge**: Let's Encrypt makes an inbound HTTP request to `http://domain.com/.well-known/acme-challenge/<token>`. It requires port 80 to be open to the internet and works only for individual domains, not wildcards.
- **DNS-01 Challenge**: cert-manager uses AWS IAM credentials to create a temporary `_acme-challenge.domain.com` TXT record directly in Route 53. Let's Encrypt verifies the TXT record. It does not require any inbound ports to be open (ideal for private VPC services) and is the **only method supported for generating wildcard certificates** (`*.ecommerce.com`).
