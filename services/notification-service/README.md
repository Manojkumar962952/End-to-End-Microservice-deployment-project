# Microservice: notification-service

## Purpose
Asynchronous event listener for order and payment domain events to send transactional notifications.

## Port Allocation
- Internal Container Port: Defined in Dockerfile
- Communication Protocol: HTTP/REST and AMQP Events

## Architecture & Boundaries
- Owns its isolated database schema.
- Communicates asynchronously via RabbitMQ domain events for cross-service transactions.

