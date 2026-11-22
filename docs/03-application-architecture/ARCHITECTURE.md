# Enterprise Application Architecture & Technical Specification

## 1. High-Level Architecture Overview

The **Enterprise E-Commerce and Order Management Platform** is a decoupled, poly-repo/monorepo microservices platform built on Node.js/TypeScript, PostgreSQL, Redis, RabbitMQ, and React.

```
                                  +-----------------------+
                                  |   React SPA Client    |
                                  |  (Vite + TypeScript)  |
                                  +-----------------------+
                                              │
                                              │ HTTPS (JWT in Auth Header)
                                              ▼
                        +───────────────────────────────────────────+
                        |           API GATEWAY (Node.js)           |
                        | - Auth Verification & Context Enrichment  |
                        | - Redis Rate Limiter                      |
                        | - Request Correlation ID (UUID v4)        |
                        | - Reverse Proxy & Circuit Breakers        |
                        +───────────────────────────────────────────+
                                              │
            ┌─────────────────────┬───────────┴─────────┬────────────────────┐
            ▼ HTTP                ▼ HTTP                ▼ HTTP               ▼ HTTP
    +───────────────+     +───────────────+     +─────────────────+  +───────────────────+
    |  Auth Service |     |  User Service |     | Product Service |  |   Order Service   |
    |   Port 5001   |     |   Port 5002   |     |    Port 5003    |  |     Port 5004     |
    +───────────────+     +───────────────+     +─────────────────+  +───────────────────+
            │                     │                     │                      │
            ▼                     ▼                     ▼                      ▼
      +-----------+         +-----------+         +-----------+          +-----------+
      |  auth_db  |         |  user_db  |         |product_db |          | order_db  |
      +-----------+         +-----------+         +-----------+          +-----------+
                                                        │                      │
                                                        │ (Cache)              ▼ (Publishes Events)
                                                        ▼             +─────────────────+
                                                   +---------+        |    RabbitMQ     |
                                                   |  Redis  |        |  Message Broker |
                                                   +---------+        +─────────────────+
                                                                               │
                                                                   ┌───────────┴───────────┐
                                                                   ▼ (Consumes)            ▼ (Consumes)
                                                          +─────────────────+     +───────────────────+
                                                          |Inventory Service|     |Payment Service    |
                                                          |    Port 5006    |     |   Port 5005       |
                                                          +─────────────────+     +───────────────────+
                                                                   │                       │
                                                                   ▼                       ▼
                                                             +-----------+           +-----------+
                                                             |  inv_db   |           |  pay_db   |
                                                             +-----------+           +-----------+
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

## 2. Microservices Directory & Port Allocation

| Service Name | Port (Internal) | Port (Local Mapped) | Database Name | Primary Responsibility |
| :--- | :--- | :--- | :--- | :--- |
| **frontend** | 3000 | 3000 | N/A | React 18 SPA UI |
| **api-gateway** | 8000 | 8000 | Redis (DB 0) | Routing, rate limiting, JWT validation, correlation IDs |
| **auth-service** | 5001 | *Internal only* | `ecommerce_auth` | User registration, login, Argon2 hashing, JWT signing |
| **user-service** | 5002 | *Internal only* | `ecommerce_user` | Customer profiles, addresses, user preferences |
| **product-service**| 5003 | *Internal only* | `ecommerce_product` | Product catalog, categories, pricing, Redis cache (DB 1) |
| **order-service** | 5004 | *Internal only* | `ecommerce_order` | Order state machine, checkout, order history |
| **payment-service**| 5005 | *Internal only* | `ecommerce_payment` | Payment processing simulation, idempotency checking |
| **inventory-service**| 5006 | *Internal only* | `ecommerce_inventory` | Atomic stock reservation, stock release, concurrency |
| **notification-service**| 5007 | *Internal only* | `ecommerce_notification` | Event consumer, simulated transactional emails |
| **postgres** | 5432 | 5432 (Dev only) | Master cluster | Isolated schemas/databases per service |
| **redis** | 6379 | 6379 (Dev only) | N/A | Distributed caching & rate limiter |
| **rabbitmq** | 5672 / 15672 | 15672 (UI) | N/A | AMQP message broker & management dashboard |

---

## 3. Database Architecture (Data-Per-Service)

### 3.1 Auth Database (`ecommerce_auth`)
```sql
CREATE TABLE users_auth (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'CUSTOMER', -- 'CUSTOMER', 'ADMIN'
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users_auth(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    family_id UUID NOT NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 3.2 Product Database (`ecommerce_product`)
```sql
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES categories(id),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 3.3 Inventory Database (`ecommerce_inventory`)
```sql
CREATE TABLE inventory (
    product_id UUID PRIMARY KEY,
    total_stock INTEGER NOT NULL CHECK (total_stock >= 0),
    reserved_stock INTEGER NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0),
    version INTEGER NOT NULL DEFAULT 0, -- Optimistic locking
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT stock_check CHECK (reserved_stock <= total_stock)
);

CREATE TABLE stock_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL,
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    status VARCHAR(50) NOT NULL, -- 'HELD', 'CONFIRMED', 'RELEASED'
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 3.4 Order Database (`ecommerce_order`)
```sql
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL,
    status VARCHAR(50) NOT NULL, -- 'PENDING', 'RESERVED', 'CONFIRMED', 'FAILED', 'CANCELLED'
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0)
);
```

### 3.5 Payment Database (`ecommerce_payment`)
```sql
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL,
    customer_id UUID NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    status VARCHAR(50) NOT NULL, -- 'SUCCESS', 'FAILED', 'REFUNDED'
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    transaction_ref VARCHAR(255) NOT NULL,
    failure_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## 4. API Gateway Endpoints & Routing Table

All external client requests hit `http://localhost:8000/api/v1/...` and are routed internally:

| Inbound Path | Method | Target Microservice | Auth Required | Rate Limit |
| :--- | :--- | :--- | :--- | :--- |
| `/api/v1/auth/register` | `POST` | `http://auth-service:5001/register` | No | 10 req/min |
| `/api/v1/auth/login` | `POST` | `http://auth-service:5001/login` | No | 10 req/min |
| `/api/v1/auth/refresh` | `POST` | `http://auth-service:5001/refresh` | No | 30 req/min |
| `/api/v1/users/me` | `GET/PUT` | `http://user-service:5002/profile` | Yes (Customer) | 60 req/min |
| `/api/v1/products` | `GET` | `http://product-service:5003/products` | No | 120 req/min |
| `/api/v1/products/:id` | `GET` | `http://product-service:5003/products/:id` | No | 120 req/min |
| `/api/v1/orders` | `POST` | `http://order-service:5004/orders` | Yes (Customer) | 30 req/min |
| `/api/v1/orders` | `GET` | `http://order-service:5004/orders` | Yes (Customer) | 60 req/min |
| `/api/v1/orders/:id` | `GET` | `http://order-service:5004/orders/:id` | Yes (Customer) | 60 req/min |
| `/api/v1/payments/simulate`| `POST`| `http://payment-service:5005/simulate` | Yes (Customer) | 20 req/min |

---

## 5. Asynchronous Event Bus Specification (RabbitMQ)

### Exchanges
- `order.topic` (Topic Exchange): Emits all order-related events.
- `payment.topic` (Topic Exchange): Emits payment events.

### Routing Keys & Messages
1. **`order.created`**
   - *Producer*: `order-service`
   - *Consumers*: `inventory-service` (reserves stock), `notification-service`
   - *Payload*: `{ orderId, customerId, items: [{ productId, quantity }], totalCents, correlationId }`

2. **`inventory.reserved`**
   - *Producer*: `inventory-service`
   - *Consumers*: `payment-service` (initiates simulated charge), `order-service`
   - *Payload*: `{ orderId, reservationId, correlationId }`

3. **`inventory.failed`**
   - *Producer*: `inventory-service`
   - *Consumers*: `order-service` (marks order `FAILED`), `notification-service`
   - *Payload*: `{ orderId, reason: 'OUT_OF_STOCK', correlationId }`

4. **`payment.succeeded`**
   - *Producer*: `payment-service`
   - *Consumers*: `order-service` (marks order `CONFIRMED`), `notification-service`
   - *Payload*: `{ orderId, paymentId, transactionRef, correlationId }`

5. **`payment.failed`**
   - *Producer*: `payment-service`
   - *Consumers*: `inventory-service` (releases stock hold - Compensating Action), `order-service` (marks `FAILED`)
   - *Payload*: `{ orderId, reason: 'DECLINED', correlationId }`
