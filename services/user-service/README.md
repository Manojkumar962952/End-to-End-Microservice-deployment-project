# Microservice: user-service

## Purpose
Customer profile management, addresses, and user preferences.

## Port Allocation
- Internal Container Port: Defined in Dockerfile
- Communication Protocol: HTTP/REST and AMQP Events

## Architecture & Boundaries
- Owns its isolated database schema.
- Communicates asynchronously via RabbitMQ domain events for cross-service transactions.

