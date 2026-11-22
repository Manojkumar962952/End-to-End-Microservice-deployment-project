# Enterprise E-Commerce & Production-Grade DevOps Platform

An enterprise-grade, distributed microservices e-commerce and order management platform built with Node.js, TypeScript, React, PostgreSQL, Redis, RabbitMQ, Docker, Kubernetes, Helm, Terraform, and GitHub Actions.

---

## 1. System Architecture Overview

```
                                      +------------------------+
                                      |   React SPA Frontend   |
                                      |  (Vite + TypeScript)   |
                                      +------------------------+
                                                  │
                                                  │ HTTPS
                                                  ▼
                         +─────────────────────────────────────────────+
                         |            API GATEWAY (Port 8000)          |
                         | - Authentication context & verification     |
                         | - Redis token-bucket rate limiting          |
                         | - Request correlation ID (`x-correlation-id`)|
                         | - Centralized routing & circuit breaking    |
                         +─────────────────────────────────────────────+
                                                  │
               ┌─────────────────────┬────────────┴─────────────┬─────────────────────┐
               ▼ HTTP                ▼ HTTP                     ▼ HTTP                ▼ HTTP
       +───────────────+     +───────────────+          +─────────────────+   +───────────────────+
       |  Auth Service |     |  User Service |          | Product Service |   |   Order Service   |
       |   Port 5001   |     |   Port 5002   |          |    Port 5003    |   |     Port 5004     |
       +───────────────+     +───────────────+          +─────────────────+   +───────────────────+
               │                     │                          │                       │
               ▼                     ▼                          ▼                       ▼
         +-----------+         +-----------+              +-----------+           +-----------+
         |  auth_db  |         |  user_db  |              |product_db |           | order_db  |
         +-----------+         +-----------+              +-----------+           +-----------+
                                                                │                       │
                                                                │ (Cache)               ▼ (Publishes Events)
                                                                ▼              +─────────────────+
                                                           +---------+         |    RabbitMQ     |
                                                           |  Redis  |         |  Message Broker |
                                                           +---------+         +─────────────────+
                                                                                        │
                                                                           ┌────────────┴────────────┐
                                                                           ▼ (Consumes)              ▼ (Consumes)
                                                                  +─────────────────+       +───────────────────+
                                                                  |Inventory Service|       |Payment Service    |
                                                                  |    Port 5006    |       |   Port 5005       |
                                                                  +─────────────────+       +───────────────────+
                                                                           │                         │
                                                                           ▼                         ▼
                                                                     +-----------+             +-----------+
                                                                     |  inv_db   |             |  pay_db   |
                                                                     +-----------+             +-----------+
                                                                                                     │
                                                                                                     ▼ (Publishes Events)
                                                                                            +───────────────────+
                                                                                            |Notification Serv. |
                                                                                            |   Port 5007       |
                                                                                            +───────────────────+
                                                                                                     │
                                                                                                     ▼
                                                                                               +-----------+
                                                                                               | notif_db  |
                                                                                               +-----------+
```

---

## 2. Repository Structure

```
coporate-project/
├── .editorconfig                          # Standard editor indentation and line endings
├── .gitignore                             # Monorepo-wide ignore rules (secrets, build artifacts)
├── .github/
│   ├── README.md                          # GitHub Actions documentation
│   └── workflows/                         # CI/CD Workflows (PR validation, SAST, Docker build, EKS deploy)
├── docker/
│   ├── README.md                          # Container orchestration guide
│   ├── compose/
│   │   ├── docker-compose.yml             # Base production-like compose
│   │   ├── docker-compose.dev.yml         # Development compose with hot reloading
│   │   └── docker-compose.test.yml        # Automated integration testing
│   └── init-scripts/                      # PostgreSQL schema & database bootstrap scripts
├── docs/                                  # 27 Specialized Engineering Chapters
│   ├── 01-business-requirements/          # Requirements specification & personas
│   ├── 02-system-design/                  # Distributed systems fundamentals & trade-offs
│   ├── 03-application-architecture/       # Microservices architecture & API contracts
│   ├── 04-microservices/                  # Decomposition & bounded contexts
│   ├── 05-docker/                         # Container security & multi-stage builds
│   ├── 06-docker-compose/                 # Local networking & persistence
│   ├── 07-application-security/           # OWASP Top 10 & secure coding checklists
│   ├── 08-github-actions/                 # GitHub Actions pipeline design
│   ├── 09-jenkins/                        # Jenkins declarative pipelines
│   ├── 10-sast-dast/                      # Security scanning (Semgrep, Trivy, ZAP)
│   ├── 11-artifact-management/            # ECR, semantic versioning, immutable tags
│   ├── 12-aws-architecture/               # Production cloud design (ap-south-1)
│   ├── 13-terraform/                      # Infrastructure as Code modules
│   ├── 14-networking/                     # Network packet lifecycle & CIDR planning
│   ├── 15-kubernetes/                     # Core Kubernetes workload design
│   ├── 16-kubernetes-security/            # Pod security standards & RBAC
│   ├── 17-helm/                           # Helm chart authoring & templating
│   ├── 18-api-gateway/                    # API gateway design & rate limiting
│   ├── 19-dns-and-tls/                    # Route 53, ACM, and TLS termination
│   ├── 20-monitoring/                     # Prometheus 4 golden signals & Grafana
│   ├── 21-logging-and-tracing/            # Structured logging & OpenTelemetry
│   ├── 22-zero-downtime-deployment/       # Rolling, canary, and blue-green strategies
│   ├── 23-cost-optimization/              # AWS cost management & rightsizing
│   ├── 24-troubleshooting/                # SRE runbooks for 20 production incidents
│   ├── 25-disaster-recovery/              # Backup strategies, RPO, and RTO
│   ├── 26-interview-preparation/          # High-level & low-level interview responses
│   ├── 27-runbooks/                       # On-call operating procedures
│   ├── DECISION_LOG.md                    # Architectural Decision Records (ADR)
│   └── PROGRESS_TRACKER.md                # Project milestone status
├── frontend/                              # React 18 + TypeScript + Vite SPA
├── helm/                                  # Production Helm charts
├── jenkins/                               # Enterprise Jenkins pipelines
├── k8s/                                   # Raw Kubernetes manifests (dev & prod overlays)
├── package.json                           # Root monorepo workspace configuration
├── scripts/                               # Maintenance & helper scripts
├── services/                              # 8 Independent Microservices
│   ├── api-gateway/                       # Ingress proxy, authentication & rate limiter
│   ├── auth-service/                      # Identity, password hashing, JWT rotation
│   ├── user-service/                      # Customer profile management
│   ├── product-service/                   # Catalog, categories, search, Redis caching
│   ├── inventory-service/                 # Stock reservation & concurrency control
│   ├── order-service/                     # Order lifecycle & Saga coordination
│   ├── payment-service/                   # Payment simulation & idempotency
│   └── notification-service/              # Asynchronous event consumer
├── shared/                                # Reusable Internal Libraries
│   ├── contracts/                         # Shared DTOs, API formats & Domain Events
│   ├── logger/                            # Structured JSON logger with correlation IDs
│   └── middleware/                        # Express correlation IDs & error handlers
└── terraform/                             # AWS Infrastructure as Code (ap-south-1)
    ├── environments/                      # dev, staging, prod
    └── modules/                           # vpc, eks, iam, ecr, rds, redis, s3, alb, route53, security
```

---

## 3. Technology Stack & Operational Ports

| Component | Technology | Default Port | Internal Port | Protocol |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend** | React 18 + Vite + TS | 3000 | 3000 | HTTP |
| **API Gateway** | Node.js + Express | 8000 | 8000 | HTTP / REST |
| **Auth Service** | Node.js + TypeScript | *Private* | 5001 | HTTP / REST |
| **User Service** | Node.js + TypeScript | *Private* | 5002 | HTTP / REST |
| **Product Service** | Node.js + TypeScript | *Private* | 5003 | HTTP / REST |
| **Order Service** | Node.js + TypeScript | *Private* | 5004 | HTTP / AMQP |
| **Payment Service** | Node.js + TypeScript | *Private* | 5005 | HTTP / AMQP |
| **Inventory Service** | Node.js + TypeScript | *Private* | 5006 | HTTP / AMQP |
| **Notification Service** | Node.js + TypeScript | *Private* | 5007 | AMQP Consumer |
| **PostgreSQL** | Postgres 16 | 5432 (Local only)| 5432 | TCP / SQL |
| **Redis** | Redis 7 Alpine | 6379 (Local only)| 6379 | TCP / RESP |
| **RabbitMQ** | RabbitMQ 3 Alpine | 15672 (Admin UI) | 5672 | TCP / AMQP |

---

## 4. Current Milestone: Phase 1 Complete
All documentation directories, system design specifications, decision logs, progress trackers, and microservice folder boundaries have been fully generated.
