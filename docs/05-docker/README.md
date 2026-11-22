# Chapter 05: Docker Containerization Architecture & Security

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                               ENTERPRISE MULTI-STAGE DOCKER ARCHITECTURE                  |
+───────────────────────────────────────────────────────────────────────────────────────────+
| [Host OS / Linux Kernel] -> cgroups (Resource Limits), Namespaces (Isolation), seccomp    |
|   ▲                                                                                       |
| [Stage 1: Builder]   node:20-alpine -> Install devDeps -> Run `tsc` -> Output `/dist`     |
|   │ (Discarded: Compiler, Source .ts files, build tools, typings, test runners)           |
|   ▼                                                                                       |
| [Stage 2: Runner]    node:20-alpine -> Minimal Production Image (<120MB)                   |
|   - Non-root Execution: `USER node` (UID 1000)                                            |
|   - Read-only container root FS with tmpfs for ephemeral writes                           |
|   - Standard Healthcheck probe (`wget --spider http://localhost:PORT/health`)              |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
Docker is an open-source containerization platform that packages an application and its entire runtime dependency tree (libraries, binaries, configuration files, and system tools) into an immutable, portable artifact called a **Container Image**. When executed, containers run as isolated processes on the host Linux kernel, sharing the host kernel while maintaining isolated namespaces (PID, NET, IPC, MNT, UTS, USER) and resource limits (cgroups).

---

## 2. Why Do Companies Use It?
- **Elimination of "Works on My Machine"**: Guaranteed parity across local development (Windows/macOS/Linux), staging, and production Kubernetes clusters.
- **Microservices Density & Fast Startup**: Unlike Virtual Machines (VMs) that boot an entire guest OS kernel taking 1–5 minutes and consuming gigabytes of memory, Docker containers start in milliseconds and share kernel resources.
- **Immutable Artifact Promotion**: The exact container image built and tested in CI is what gets pushed to Amazon ECR and deployed to production, eliminating configuration drift.

---

## 3. What Problem Does It Solve?
- **Dependency Hell**: Multiple services requiring different Node.js or Python versions run concurrently on the same host without conflicts.
- **Resource Starvation**: Linux Control Groups (`cgroups v2`) restrict CPU cores, memory limits, and IOPS per microservice, preventing a memory leak in one service from crashing neighboring processes.
- **Attack Surface Minimization**: Multi-stage builds strip compilers, package managers, and debugging utilities from production runtime images.

---

## 4. How Does It Work Internally?
1. **Linux Namespaces**:
   - `pid`: Process isolation (PID 1 inside container is isolated from host PID tree).
   - `net`: Network virtualization (each container has its own `eth0` interface, IP, routing table, and iptables rules).
   - `mnt`: Filesystem mount point isolation.
   - `ipc`: Inter-process communication isolation (shared memory, semaphores).
   - `user`: Maps container UID to unprivileged host UID.
2. **Control Groups (`cgroups`)**:
   - Imposes hard boundaries on CPU shares, memory allocation (`oom-killer`), and blkio throughput.
3. **Union Filesystem (OverlayFS)**:
   - Images are composed of immutable, content-addressable read-only layers (`lowerdir`).
   - When a container runs, Docker attaches a thin copy-on-write (CoW) read-write layer (`upperdir`) merged into the visible container filesystem (`merged`).

---

## 5. Where Does It Fit in Our Architecture?
Every component in the Enterprise Platform is containerized:
- **8 Backend Microservices**: Node.js 20 Alpine multi-stage builds.
- **Frontend SPA**: React 18 built via Vite and served over Alpine NGINX.
- **Stateful Backing Services**: PostgreSQL 16 Alpine, Redis 7 Alpine, and RabbitMQ 3.13 Management Alpine.

---

## 6. How Do We Implement It?
We implement strict multi-stage Dockerfiles enforcing workspace dependency resolution and non-root execution:

```dockerfile
# Stage 1: Build stage
FROM node:20-alpine AS builder
WORKDIR /usr/src/app

COPY package*.json ./
COPY shared/ ./shared/
COPY services/order-service/ ./services/order-service/

RUN npm install
RUN npm run build -w shared/contracts -w shared/logger -w shared/middleware
RUN npm run build -w services/order-service

# Stage 2: Production runner stage
FROM node:20-alpine AS runner
WORKDIR /usr/src/app

ENV NODE_ENV=production
COPY package*.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/shared/contracts/dist ./shared/contracts/dist
COPY --from=builder /usr/src/app/shared/logger/dist ./shared/logger/dist
COPY --from=builder /usr/src/app/shared/middleware/dist ./shared/middleware/dist
COPY --from=builder /usr/src/app/services/order-service/dist ./services/order-service/dist
COPY --from=builder /usr/src/app/services/order-service/package.json ./services/order-service/

USER node
EXPOSE 5004

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5004/health || exit 1

CMD ["node", "services/order-service/dist/index.js"]
```

---

## 7. Configuration Examples
`.dockerignore` prevents accidental leakage of local development artifacts and secrets into container layers:
```
node_modules
dist
.git
.env*
npm-debug.log*
Dockerfile*
docker-compose*
README.md
```

---

## 8. Commands
```powershell
# Build image with specific tag
docker build -t ecommerce-order-service:1.0.0 -f services/order-service/Dockerfile .

# Inspect image layers and size distribution
docker history ecommerce-order-service:1.0.0

# Run container with resource limits and non-root verification
docker run -d --name order-svc --memory="256m" --cpus="0.5" -p 5004:5004 ecommerce-order-service:1.0.0

# Execute interactive shell inside running container as node user
docker exec -it order-svc sh
```

---

## 9. Verification
```powershell
# 1. Verify unprivileged execution (Must return UID 1000 / node, NOT 0 / root)
docker exec -it order-svc id

# 2. Verify healthcheck status
docker inspect --format='{{json .State.Health.Status}}' order-svc

# 3. Check memory & CPU utilization stats
docker stats --no-stream
```

---

## 10. Common Mistakes
1. **Running as `root` (UID 0)**: Leaving default root execution enables container breakout vulnerabilities. Always specify `USER node` or unprivileged UID.
2. **Missing `.dockerignore`**: Committing local `node_modules` or `.env` files into the Docker build context causes build failures and exposes sensitive credentials.
3. **Using `latest` tag in Production**: `latest` creates non-deterministic builds. Always pin immutable semantic version tags or git commit SHAs (e.g., `:sha-f1d3770`).
4. **Ordering Dockerfile instructions inefficiently**: Copying source code before `package.json` invalidates Docker layer cache on every code change, forcing re-download of all dependencies.

---

## 11. Troubleshooting
- **Error: `ENOTFOUND` or `fetch failed` during Docker build**: Docker daemon cannot resolve DNS. Configure DNS in Docker Desktop settings or `/etc/docker/daemon.json` (`"dns": ["8.8.8.8", "1.1.1.1"]`).
- **Container Exits Immediately with Code 137**: Process killed by Linux Out-Of-Memory (`OOMKilled`). Inspect `docker inspect <container> --format='{{.State.OOMKilled}}'` and increase memory limit.
- **Port Bind Error (`bind: address already in use`)**: Another process or zombie container occupies the host port. Identify with `netstat -ano | findstr <port>` and terminate the process.

---

## 12. Security Best Practices
- **Minimal Base Images**: Use Alpine (`node:20-alpine`) or Distroless (`gcr.io/distroless/nodejs20-debian12`) to eliminate unnecessary shells and binaries (`curl`, `nc`).
- **Read-Only Root Filesystem**: Deploy with `--read-only` flag to prevent attackers from writing malware or modifying binaries at runtime.
- **Drop Kernel Capabilities**: Remove all default Linux capabilities except those strictly required (`--cap-drop=ALL`).
- **Automated Container Vulnerability Scanning**: Run Trivy or Grype in CI to reject images containing Critical or High CVEs before deployment.

---

## 13. Real-World Use Cases
- **Standardizing Multi-Language Polyglot Architectures**: Uber and Netflix package thousands of microservices across Java, Go, Node.js, and Python into standardized Docker runtime envelopes deployed onto Kubernetes.
- **Ephemeral CI/CD Build Agents**: GitHub Actions and Jenkins spin up isolated Docker containers dynamically for every build job, ensuring clean, hermetic test environments.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: What is the difference between a Docker Image and a Docker Container?
**Answer**: An image is an immutable, read-only template built from ordered filesystem layers representing the application and dependencies at a point in time. A container is a live, stateful execution instance of an image running in isolated kernel namespaces with a top-level Copy-on-Write (CoW) read-write layer.

### Q2: Why is multi-stage Docker build critical for enterprise microservices?
**Answer**: It enforces separation of concerns between build-time and runtime. Build dependencies (TypeScript compiler, headers, dev dependencies) bloat image size to over 1 GB and introduce substantial security vulnerabilities. Multi-stage builds yield minimal production images (<120 MB), reducing attack surfaces, accelerating network transfer times, and speeding up Kubernetes Pod startup.

### Q3: How does Docker prevent a container from consuming all host RAM and crashing the server?
**Answer**: Docker leverages Linux kernel Control Groups (`cgroups`). When starting a container with `--memory="512m"`, the kernel tracks memory pages allocated to that cgroup. If the container exceeds its limit and swap is exhausted, the Linux Out-Of-Memory (OOM) Killer terminates the primary process in that container (Exit Code 137), safeguarding the host and neighboring containers.
