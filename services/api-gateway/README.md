# Microservice: api-gateway

## Purpose
Central API entry point, reverse proxy, JWT authentication context injection, rate limiting, correlation IDs.

## Port Allocation
- Internal Container Port: Defined in Dockerfile
- Communication Protocol: HTTP/REST and AMQP Events

## Architecture & Boundaries
- Owns its isolated database schema.
- Communicates asynchronously via RabbitMQ domain events for cross-service transactions.

