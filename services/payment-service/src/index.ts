import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Pool } from 'pg';
import amqplib, { Channel, Connection } from 'amqplib';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '@enterprise/logger';
import { correlationIdMiddleware, createErrorHandler, AppError } from '@enterprise/middleware';
import { EventTypes, InventoryReservedEvent } from '@enterprise/contracts';

dotenv.config();

const config = {
  serviceName: 'payment-service',
  port: parseInt(process.env.PORT || '5005', 10),
  db: {
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres_secret',
    database: process.env.DB_NAME || 'ecommerce_payment'
  },
  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672'
  }
};

const logger = createLogger(config.serviceName);
const pool = new Pool(config.db);
let channel: Channel | null = null;
const EXCHANGE = 'ecommerce.events';

async function initRabbitMQ() {
  try {
    const conn: Connection = await amqplib.connect(config.rabbitmq.url);
    channel = await conn.createChannel();
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

    const q = await channel.assertQueue('payment.inventory.reserved', { durable: true });
    await channel.bindQueue(q.queue, EXCHANGE, EventTypes.INVENTORY_RESERVED);

    logger.info('Payment service connected to RabbitMQ.');

    channel.consume(q.queue, async (msg) => {
      if (!msg) return;
      const content = JSON.parse(msg.content.toString()) as InventoryReservedEvent;
      await processSimulatedPayment(content.payload.orderId, content.correlationId);
      channel?.ack(msg);
    });
  } catch (err) {
    logger.warn('RabbitMQ connection retry in 5s...', undefined, err as Error);
    setTimeout(initRabbitMQ, 5000);
  }
}

async function processSimulatedPayment(orderId: string, correlationId: string) {
  const idempotencyKey = `auto-order-${orderId}`;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check idempotency
    const existing = await client.query('SELECT * FROM payments WHERE idempotency_key = $1', [idempotencyKey]);
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return;
    }

    // Realistic Simulation: 95% success, 5% decline
    const isSuccess = Math.random() < 0.95;
    const transactionRef = 'txn_' + uuidv4().substring(0, 12);
    const status = isSuccess ? 'SUCCESS' : 'FAILED';
    const failureReason = isSuccess ? null : 'SIMULATED_CARD_DECLINE';

    const res = await client.query(
      `INSERT INTO payments (order_id, customer_id, amount_cents, currency, status, idempotency_key, transaction_ref, failure_reason)
       VALUES ($1, gen_random_uuid(), 5000, 'USD', $2, $3, $4, $5)
       RETURNING *`,
      [orderId, status, idempotencyKey, transactionRef, failureReason]
    );

    await client.query('COMMIT');

    if (isSuccess) {
      logger.info(`Payment succeeded for order ${orderId}`, { correlationId, transactionRef });
      publishEvent(EventTypes.PAYMENT_SUCCEEDED, {
        orderId,
        paymentId: res.rows[0].id,
        transactionRef,
        amountCents: 5000
      }, correlationId);
    } else {
      logger.warn(`Payment failed for order ${orderId}`, { correlationId, failureReason });
      publishEvent(EventTypes.PAYMENT_FAILED, {
        orderId,
        reason: failureReason
      }, correlationId);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`Error processing payment for order ${orderId}`, { correlationId }, err as Error);
    publishEvent(EventTypes.PAYMENT_FAILED, { orderId, reason: 'PAYMENT_GATEWAY_ERROR' }, correlationId);
  } finally {
    client.release();
  }
}

function publishEvent(eventType: string, payload: unknown, correlationId: string) {
  if (!channel) return;
  const message = {
    eventId: uuidv4(),
    eventType,
    timestamp: new Date().toISOString(),
    correlationId,
    payload
  };
  channel.publish(EXCHANGE, eventType, Buffer.from(JSON.stringify(message)), { persistent: true });
}

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(correlationIdMiddleware);

app.get('/health/live', (_req, res) => res.json({ status: 'UP', service: config.serviceName }));
app.get('/health/ready', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'READY', service: config.serviceName });
  } catch {
    res.status(503).json({ status: 'NOT_READY' });
  }
});

app.use(createErrorHandler(logger));

const server = app.listen(config.port, () => {
  logger.info(`${config.serviceName} listening on port ${config.port}`);
  initRabbitMQ();
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
