# Microservice: auth-service

## Purpose
Customer registration, login, Argon2id password hashing, JWT Access & Refresh token rotation.

## Port Allocation
- Internal Container Port: Defined in Dockerfile
- Communication Protocol: HTTP/REST and AMQP Events

## Architecture & Boundaries
- Owns its isolated database schema.
- Communicates asynchronously via RabbitMQ domain events for cross-service transactions.

