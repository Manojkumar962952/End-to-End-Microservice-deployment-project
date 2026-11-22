# Senior SRE Guide: Local Orchestration with Docker Compose

This document details how the local development, testing, and production-like environments are orchestrated using Docker Compose.

---

## 1. Network Architecture & Security Isolation

Our `docker-compose.yml` implements two isolated virtual bridge networks:

```
                   HOST MACHINE (Your Laptop)
                               │
                       Port 8000 (HTTP)
                               │
                               ▼
        +───────────────────────────────────────────────+
        |            ecommerce-public-net               |
        +───────────────────────────────────────────────+
                               │
                               ▼
                      [ api-gateway Pod ]
                               │
        +───────────────────────────────────────────────+
        |            ecommerce-internal-net             |
        +───────────────────────────────────────────────+
            │         │         │         │         │
            ▼         ▼         ▼         ▼         ▼
        [ auth ]  [ user ]  [ order ] [ payment ] [ postgres ]
                                                  (Port 5432 Private)
```

- **`ecommerce-public-net`**: Only connects `api-gateway` and the frontend.
- **`ecommerce-internal-net`**: Connects backend services, database, cache, and message broker.
- **Security Guarantee**: Databases and RabbitMQ message broker are **not exposed** on the host machine network in the default production-like configuration.

---

## 2. Environments Overview

1. **`docker-compose.yml` (Base / Production Simulation)**:
   - All services run as non-root containers.
   - Internal ports hidden from host.
   - Full healthcheck dependencies.

2. **`docker-compose.dev.yml` (Development Overlay)**:
   - Exposes PostgreSQL (5432) and Redis (6379) to host for local database inspection tools (DBeaver, TablePlus, Redis Commander).

3. **`docker-compose.test.yml` (Automated Integration Runner)**:
   - Spawns an ephemeral integration test runner container connected to the internal network.

---

## 3. How to Run & Verify

### Starting the Platform
```powershell
# Build and start all 8 microservices, PostgreSQL, Redis, and RabbitMQ
docker compose up -d --build
```

### Checking Status & Health
```powershell
docker compose ps
```
You should see all containers listed with `State: Up (healthy)`.

### Viewing Structured Logs
```powershell
# Stream logs from the API Gateway
docker compose logs -f api-gateway

# Stream logs from Order and Payment services
docker compose logs -f order-service payment-service
```

### Running Automated E2E Verification
```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/verify-local.ps1
```

### Tearing Down the Environment
```powershell
# Stop containers
docker compose down

# Stop and wipe persistent volumes (clean slate)
docker compose down -v
```
