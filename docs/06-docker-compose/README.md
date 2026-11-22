# Chapter 06: Docker Compose Multi-Container Local Orchestration

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|                               DOCKER COMPOSE NETWORK TOPOLOGY                             |
+───────────────────────────────────────────────────────────────────────────────────────────+
| [Host Port 3000] ──> ecommerce-frontend   [ecommerce-public-net: 172.18.0.0/16]          |
| [Host Port 8000] ──> ecommerce-api-gateway ─────────┐                                    |
| [Host Port 15672] ─> ecommerce-rabbitmq (Mgmt UI)    │ (Reverse Proxy)                    |
|                                                      ▼                                    |
|                     =================================================                     |
|                     [ecommerce-internal-net: 172.19.0.0/16 - Private]                     |
|                     =================================================                     |
|                     ├── auth-service:5001       ├── postgres:5432                         |
|                     ├── user-service:5002       ├── redis:6379                            |
|                     ├── product-service:5003    └── rabbitmq:5672                         |
|                     ├── order-service:5004                                                |
|                     ├── payment-service:5005                                              |
|                     ├── inventory-service:5006                                            |
|                     └── notification-service:5007                                         |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 1. What is It?
Docker Compose is a declarative tool for defining and running multi-container Docker applications. Using YAML configuration files (`docker-compose.yml`), developers define multiple services, networks, volumes, health checks, dependency startup order, and environment variables, launching the entire topology with a single command (`docker compose up -d`).

---

## 2. Why Do Companies Use It?
- **One-Command Environment Provisioning**: Replaces lengthy multi-page onboarding setup guides with a single `docker compose up -d` command, saving engineering hours for new hires.
- **Hermetic Testing Environments**: Enables automated end-to-end (E2E) integration tests in CI pipelines where microservices, databases, and message brokers are spun up in isolation and torn down cleanly.
- **Architectural Mirroring**: Models network isolation, database schemas, and service-to-service communication locally before deploying to expensive cloud environments.

---

## 3. What Problem Does It Solve?
- **Manual Port & Linking Clashes**: Eliminates brittle host scripts managing individual `docker run` commands with tangled network port bindings.
- **Race Conditions on Boot**: Prevents backend services from crashing when booting up before PostgreSQL or RabbitMQ are ready, using deterministic `depends_on` conditions (`service_healthy`).
- **Data Ephemerality**: Manages persistent Docker named volumes so database state survives container restarts during development.

---

## 4. How Does It Work Internally?
1. **Network Provisioning**: Creates user-defined bridge networks. Each container receives an IP on that bridge and registers its service name with Docker's embedded DNS resolver (`127.0.0.11`).
2. **Dependency & Health Check Engine**: Evaluates `condition: service_healthy` before launching dependent services.
3. **Volume Mounting**: Attaches Docker managed volumes (`/var/lib/docker/volumes/...`) to container mount points (e.g. `/var/lib/postgresql/data`), decoupling data persistence from container lifecycles.

---

## 5. Where Does It Fit in Our Architecture?
Docker Compose orchestrates all 12 containers of our local platform:
1. `ecommerce-frontend` (Port 3000)
2. `ecommerce-api-gateway` (Port 8000)
3. 6 internal core business microservices (auth, user, product, order, payment, inventory, notification)
4. Backing stateful engines: `postgres` (7 partitioned schemas), `redis` (catalog caching & rate limiting), and `rabbitmq` (AMQP event bus).

---

## 6. How We Implemented It in This Project
Our implementation utilizes network segmentation to isolate databases and backend services from direct public exposure:

```yaml
version: '3.8'

networks:
  ecommerce-public-net:
    driver: bridge
  ecommerce-internal-net:
    driver: bridge

volumes:
  postgres_data:
  redis_data:
  rabbitmq_data:

services:
  postgres:
    image: postgres:16-alpine
    container_name: ecommerce-postgres
    networks:
      - ecommerce-internal-net
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-ecommerce_admin}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-admin_secure_password_2026}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/init-scripts:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ecommerce_admin"]
      interval: 5s
      timeout: 5s
      retries: 5

  order-service:
    build:
      context: .
      dockerfile: services/order-service/Dockerfile
    container_name: ecommerce-order-service
    networks:
      - ecommerce-internal-net
    environment:
      PORT: 5004
      DATABASE_URL: postgres://ecommerce_admin:admin_secure_password_2026@postgres:5432/ecommerce_order
      RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672
    depends_on:
      postgres:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy
```

---

## 7. Configuration Examples
### Multiple Compose Overrides
In enterprise projects, separate files are maintained for different environments:
- `docker-compose.yml`: Base architecture and production container topology.
- `docker-compose.dev.yml`: Mounts local host source code volumes into containers for live hot-reload (`nodemon` / `ts-node`).
- `docker-compose.test.yml`: Runs automated integration test suites and terminates on completion (`--abort-on-container-exit`).

---

## 8. Commands
```powershell
# Start all 12 containers in detached mode with build
docker compose up -d --build

# View health status and port bindings of all services
docker compose ps

# Follow aggregated real-time logs across all services
docker compose logs -f --tail=100

# View logs for a specific service
docker compose logs -f order-service

# Gracefully terminate containers, networks, and keep data volumes intact
docker compose down

# Wipe entire environment including databases and volumes (clean slate)
docker compose down -v
```

---

## 9. Verification
```powershell
# 1. Verify all 12 containers report state "Up (healthy)" or "Up"
docker compose ps

# 2. Verify API Gateway routing to Order Service
Invoke-RestMethod -Uri "http://localhost:8000/api/v1/orders/health" -Method Get

# 3. Verify internal DNS resolution between containers
docker compose exec order-service ping -c 2 postgres
```

---

## 10. Common Mistakes
1. **Relying on bare `depends_on` without health checks**: Bare `depends_on` only waits for container creation, not readiness. PostgreSQL or RabbitMQ take 3-10 seconds to accept connections. Always use `condition: service_healthy`.
2. **Exposing internal databases on host ports**: Exposing `5432:5432` publicly in production or local stacks invites credential brute-forcing. Only public gateways should expose host ports.
3. **Hardcoding container IP addresses**: Containers receive dynamic IP addresses upon restart. Always address services by their compose service name (`postgres`, `rabbitmq`, `redis`).

---

## 11. Troubleshooting
- **Zombie containers holding ports**: Run `docker compose down --remove-orphans`.
- **Database schema changes not applying**: PostgreSQL only executes `/docker-entrypoint-initdb.d` scripts when the data volume is empty. If schemas change, run `docker compose down -v` to recreate volumes.
- **Out of disk space**: Remove dangling build layers and unused volumes with `docker system prune -a --volumes`.

---

## 12. Security Best Practices
- **Network Segmentation**: Separate public ingress network from internal database networks.
- **Secret Management via Environment Variables**: Use `.env` file templates (`.env.example`) and never commit plaintext credentials to Git repositories.
- **Resource Constraints**: Define `deploy.resources.limits` (CPU and Memory) to prevent any single microservice from monopolizing developer workstations.

---

## 13. Real-World Use Cases
- **Local Developer Environments**: Engineering teams of 50+ developers run the entire company platform locally on laptops without cloud dependencies.
- **Automated Pull Request Integration Gates**: GitHub Actions spawns the Compose stack, runs end-to-end Cypress or Playwright tests, and destroys the stack upon PR completion.

---

## 14. Senior DevOps Interview Questions & Answers
### Q1: What is the difference between `depends_on` and `healthcheck` in Docker Compose?
**Answer**: `depends_on` determines container startup order, but by default it only waits until the dependent container's process is launched, not until it is functionally ready to serve traffic. A database may take several seconds to initialize schemas. Combining `depends_on` with `condition: service_healthy` ensures dependent microservices wait until the target container passes its custom health check (e.g., `pg_isready`), eliminating startup race conditions.

### Q2: How does Docker Compose resolve service names without external DNS servers?
**Answer**: Docker Compose creates an isolated user-defined bridge network. Docker runs an embedded DNS server at `127.0.0.11` within the network namespace. When a container issues a DNS query for `order-service` or `postgres`, Docker's DNS intercepts the request and returns the container's private bridge IP address.

### Q3: When should a team transition from Docker Compose to Kubernetes?
**Answer**: Docker Compose is ideal for single-host local development, small staging servers, and simple CI testing pipelines. It lacks multi-node clustering, automated horizontal pod autoscaling (HPA), self-healing node failover, rolling zero-downtime updates across availability zones, complex ingress routing, and service mesh capabilities. When high availability, zero downtime, multi-host distribution, and elastic scaling are required, Kubernetes is the industry standard.
