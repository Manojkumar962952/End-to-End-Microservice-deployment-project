# Microservice: inventory-service

## Purpose
Stock tracking, atomic reservation during checkout, and concurrency management.

## Port Allocation
- Internal Container Port: Defined in Dockerfile
- Communication Protocol: HTTP/REST and AMQP Events

## Architecture & Boundaries
- Owns its isolated database schema.
- Communicates asynchronously via RabbitMQ domain events for cross-service transactions.

