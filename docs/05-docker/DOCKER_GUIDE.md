# Senior SRE Guide: Docker Containerization & Security

This guide explains the containerization architecture of this enterprise microservices platform, multi-stage build design, and container security best practices.

---

## 1. Multi-Stage Docker Builds

### The Problem in Traditional Builds
In naive Dockerfiles, build tools (TypeScript compiler `tsc`, npm devDependencies, test runners, linters, source code, git history) are bundled into the final production image.
- Image size reaches **1.5 GB+**.
- Increased attack surface: build tools provide utilities that attackers can exploit if a container is compromised.
- Slower CI/CD transfer speeds to Amazon ECR.

### The Enterprise Solution: Multi-Stage Build
We split the `Dockerfile` into two distinct stages:

```
+────────────────────────────────────────────────────────────+
| Stage 1: builder (node:20-alpine)                         |
| - Installs devDependencies                                 |
| - Compiles TypeScript (.ts) into JavaScript (.js) in /dist |
| - Runs linter and contract verification                    |
+────────────────────────────────────────────────────────────+
                              │
               Only /dist and runtime node_modules copied
                              │
                              ▼
+────────────────────────────────────────────────────────────+
| Stage 2: runner (node:20-alpine)                           |
| - Only production dependencies (npm install --omit=dev)   |
| - No compiler, no dev tools                                |
| - Final Image Size: < 120 MB                               |
+────────────────────────────────────────────────────────────+
```

---

## 2. Container Security: Non-Root Execution

### Why Running as `root` is Dangerous
By default, Docker containers execute processes as `root` (UID 0).
If an attacker discovers a Remote Code Execution (RCE) vulnerability in an Express endpoint or a vulnerable dependency, they gain root privileges inside the container. If a kernel exploit exists (container escape), they gain root privileges over the host machine!

### Our Implementation
Every Dockerfile in this project includes:
```dockerfile
USER node
```
The official Node.js Alpine base image includes a pre-configured unprivileged user named `node` (UID 1000). The service runs with minimum required Linux permissions.

---

## 3. How Containers Communicate: Docker DNS & Bridge Networks

In Docker Compose, Docker creates a user-defined bridge network (e.g., `ecommerce-internal-net`).
- Docker runs an embedded DNS server on `127.0.0.11`.
- When `order-service` connects to `postgres:5432` or `rabbitmq:5672`, the internal Docker DNS server automatically resolves the service name `postgres` to its private container IP address (e.g., `172.20.0.3`).
- **No hardcoded IP addresses are used anywhere in the architecture**.

---

## 4. Docker Health Checks

A running container process does not mean the application is ready to accept traffic. The Node process might have started, but PostgreSQL connection pool creation or RabbitMQ channel initialization might still be pending.

### Syntax Difference
- In Compose:
  ```yaml
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres"]
    interval: 5s
    timeout: 5s
    retries: 10
  ```
  `depends_on` with `condition: service_healthy` ensures dependent microservices do not start until PostgreSQL and RabbitMQ are fully initialized and healthy.

---

## 5. Docker Troubleshooting Commands

| Command | Purpose |
| :--- | :--- |
| `docker compose ps` | View status, port mapping, and health status of all containers. |
| `docker compose logs -f <service>` | Stream logs for a specific service in real time. |
| `docker compose exec <service> sh` | Open an interactive shell inside a running container. |
| `docker stats` | Live stream of CPU, memory usage, network I/O per container. |
| `docker network inspect ecommerce-internal-net` | Inspect connected containers and their internal IPs. |
| `docker compose down -v` | Teardown containers and clean up persistent volumes. |
