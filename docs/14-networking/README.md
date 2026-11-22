# Enterprise Networking & Request Packet Lifecycle Guide

```
+─────────────────────────────────────────────────────────────────────────────────────────────────────────+
|                                  COMPLETE CUSTOMER PACKET LIFECYCLE                                     |
+─────────────────────────────────────────────────────────────────────────────────────────────────────────+
| 1. Client Browser (DNS Lookup for domain -> Resolves Host IP)                                           |
| 2. TCP 3-Way Handshake (SYN -> SYN-ACK -> ACK)                                                          |
| 3. TLS 1.3 Handshake (ClientHello -> ServerHello, Certificate, Key Exchange -> Encrypted Session)       |
| 4. Packet strikes Host Machine on Port 8000                                                             |
| 5. Docker Virtual Interface (veth) routes packet to `ecommerce-public-net` (172.18.0.0/16)              |
| 6. Container: `api-gateway` (Port 8000) accepts HTTP socket                                             |
| 7. Gateway inspects path & queries internal Docker DNS (`127.0.0.11`) for `order-service`              |
| 8. Packet forwarded across `ecommerce-internal-net` (172.19.0.0/16) to `order-service:5004`            |
| 9. `order-service` queries `postgres:5432` and connects to `rabbitmq:5672` over internal bridge network|
+─────────────────────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is Enterprise Application Networking?
Application networking defines the protocols, routing topologies, network boundaries, and packet forwarding rules that allow clients to reach application entry points securely while strictly isolating internal services, databases, and message brokers from unauthorized public exposure.

---

## 2. Why Do Companies Prioritize Network Architecture?
- **Zero-Trust Security**: Defense-in-depth requires that backend microservices and databases are **never assigned public IP addresses** or exposed on public ports.
- **Latency Optimization**: Subnet routing, keep-alive connection pooling, and HTTP/2 multiplexing reduce latency by hundreds of milliseconds.
- **Fault Containment**: Segmenting networks prevents an attacker who compromises a public web server from directly traversing into private payment or database subnets.

---

## 3. Network Fundamentals: Core Concepts

### 3.1 Public vs. Private IP Addresses
- **Public IPs**: Globally routable on the public internet, assigned by IANA/ISPs.
- **Private IPs (RFC 1918)**: Non-routable on the public internet, reserved for internal networks:
  - `10.0.0.0/8`
  - `172.16.0.0/12` (Used by Docker virtual bridges)
  - `192.168.0.0/16` (Common home/office LANs)

### 3.2 CIDR (Classless Inter-Domain Routing) Notation
A CIDR block specifies an IP address and its subnet mask:
$$\text{Available Host IPs} = 2^{32 - \text{prefix}} - 2$$
- `172.20.0.0/16`: Mask has 16 bits fixed. Leaves 16 bits for hosts: $2^{16} - 2 = 65,534$ IP addresses.
- `10.0.1.0/24`: Mask has 24 bits fixed. Leaves 8 bits for hosts: $2^8 - 2 = 254$ IP addresses. (5 IPs reserved by AWS VPC).

### 3.3 TCP 3-Way Handshake
Before any HTTP request can be transmitted, TCP establishes a reliable connection:
1. **SYN**: Client sends Synchronize packet with initial sequence number $x$.
2. **SYN-ACK**: Server acknowledges with ACK $x+1$ and sends its sequence number $y$.
3. **ACK**: Client acknowledges with ACK $y+1$. Connection is ESTABLISHED.

### 3.4 TLS 1.3 Handshake (HTTPS)
1. **ClientHello**: Client sends supported cipher suites and key share.
2. **ServerHello**: Server selects cipher, provides ACM/Let's Encrypt certificate and key share.
3. **Session Keys Derived**: Both sides compute symmetric session keys ($0$-RTT or $1$-RTT).
4. **Encrypted Data**: Application HTTP payload is encrypted using AES-GCM or ChaCha20.

---

## 4. Docker Virtual Networking in Our Project

In [`docker-compose.yml`](file:///c:/Users/Admin/Desktop/coporate-project/docker-compose.yml), we configure two distinct bridge networks:

```yaml
networks:
  public-net:
    driver: bridge
    name: ecommerce-public-net
  internal-net:
    driver: bridge
    name: ecommerce-internal-net
```

### How Containers Resolve Each Other via Docker Embedded DNS
1. Docker runs an internal DNS resolver at `127.0.0.11`.
2. When `order-service` calls `http://postgres:5432`, the container queries `127.0.0.11`.
3. Docker DNS checks the container roster on `ecommerce-internal-net` and returns the private container IP (e.g. `172.19.0.2`).
4. **Zero hardcoded IP addresses** exist in our application code.

---

## 5. Security Boundary Verification

Inspect how network isolation is enforced on your machine:

```powershell
# Inspect containers on public network (Only Gateway and Frontend)
docker network inspect ecommerce-public-net

# Inspect containers on internal network (Backend services, Postgres, Redis, RabbitMQ)
docker network inspect ecommerce-internal-net
```

---

## 6. Senior Interview Questions & Answers

### Q1: What is the difference between a Forward Proxy and a Reverse Proxy?
> **Answer**:
> - A **Forward Proxy** sits in front of clients (e.g. a corporate proxy). It acts on behalf of clients to fetch resources from the internet, masking client identity and filtering outbound traffic.
> - A **Reverse Proxy** sits in front of backend servers (e.g. API Gateway, NGINX). It acts on behalf of servers to receive requests from clients, terminate TLS, load balance, and mask backend server topology.

### Q2: Why shouldn't a database container have its port mapped to the host (`5432:5432`) in production?
> **Answer**: Mapping a port (`5432:5432`) instructs Docker to bind the host machine's `0.0.0.0` interface. This exposes the database to the host's physical network, making it vulnerable to brute-force attacks and port scans. By attaching the database strictly to an internal Docker network without port bindings, the database can only be reached by containers on that same internal virtual bridge.
