import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Pool } from 'pg';
import amqplib from 'amqplib';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '@enterprise/logger';
import { correlationIdMiddleware, createErrorHandler, AppError } from '@enterprise/middleware';
import { EventTypes, OrderCreatedEvent, PaymentFailedEvent } from '@enterprise/contracts';

dotenv.config();

const config = {
  serviceName: 'inventory-service',
  port: parseInt(process.env.PORT || '5006', 10),
  db: {
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres_secret',
    database: process.env.DB_NAME || 'ecommerce_inventory'
  },
  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672'
  }
};

const logger = createLogger(config.serviceName);
const pool = new Pool(config.db);
let channel: any = null;

const EXCHANGE = 'ecommerce.events';

async function initRabbitMQ() {
  try {
    const conn: any = await amqplib.connect(config.rabbitmq.url);
    const ch = await conn.createChannel();
    channel = ch;
    await ch.assertExchange(EXCHANGE, 'topic', { durable: true });

    // Queue for order creation events
    const q = await ch.assertQueue('inventory.order.created', { durable: true });
    await ch.bindQueue(q.queue, EXCHANGE, EventTypes.ORDER_CREATED);
    await ch.bindQueue(q.queue, EXCHANGE, EventTypes.PAYMENT_FAILED);

    logger.info('Connected to RabbitMQ and initialized inventory queues.');

    ch.consume(q.queue, async (msg: any) => {
      if (!msg) return;
      const content = JSON.parse(msg.content.toString());
      const routingKey = msg.fields.routingKey;

      if (routingKey === EventTypes.ORDER_CREATED) {
        await handleOrderCreated(content as OrderCreatedEvent);
      } else if (routingKey === EventTypes.PAYMENT_FAILED) {
        await handlePaymentFailed(content as PaymentFailedEvent);
      }

      ch.ack(msg);
    });
  } catch (err: any) {
    logger.warn('RabbitMQ connection retry in 5s...', undefined, err as Error);
    setTimeout(initRabbitMQ, 5000);
  }
}

// Atomic stock reservation with row locking
async function handleOrderCreated(event: OrderCreatedEvent) {
  const { orderId, items } = event.payload;
  const correlationId = event.correlationId;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let canFulfill = true;
    for (const item of items) {
      // Row-level lock to prevent race conditions during concurrent checkouts
      const res = await client.query(
        'SELECT total_stock, reserved_stock FROM inventory WHERE product_id = $1 FOR UPDATE',
        [item.productId]
      );

      if (res.rows.length === 0) {
        canFulfill = false;
        break;
      }

      const { total_stock, reserved_stock } = res.rows[0];
      if (total_stock - reserved_stock < item.quantity) {
        canFulfill = false;
        break;
      }
    }

    if (!canFulfill) {
      await client.query('ROLLBACK');
      logger.warn(`Insufficient stock for order ${orderId}`, { correlationId });
      publishEvent(EventTypes.INVENTORY_FAILED, { orderId, reason: 'OUT_OF_STOCK' }, correlationId);
      return;
    }

    // Reserve stock
    const reservationId = uuidv4();
    for (const item of items) {
      await client.query(
        'UPDATE inventory SET reserved_stock = reserved_stock + $1, updated_at = NOW() WHERE product_id = $2',
        [item.quantity, item.productId]
      );

      await client.query(
        `INSERT INTO stock_reservations (id, order_id, product_id, quantity, status, expires_at)
         VALUES ($1, $2, $3, $4, 'HELD', NOW() + INTERVAL '15 minutes')`,
        [reservationId, orderId, item.productId, item.quantity]
      );
    }

    await client.query('COMMIT');
    logger.info(`Stock reserved for order ${orderId}`, { correlationId, reservationId });
    publishEvent(EventTypes.INVENTORY_RESERVED, { orderId, reservationId }, correlationId);
  } catch (err: any) {
    await client.query('ROLLBACK');
    logger.error(`Stock reservation transaction failed for ${orderId}`, { correlationId }, err as Error);
    publishEvent(EventTypes.INVENTORY_FAILED, { orderId, reason: 'SYSTEM_ERROR' }, correlationId);
  } finally {
    client.release();
  }
}

// Compensating transaction: release stock on payment failure
async function handlePaymentFailed(event: PaymentFailedEvent) {
  const { orderId } = event.payload;
  const correlationId = event.correlationId;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const reservations = await client.query(
      `SELECT product_id, quantity FROM stock_reservations WHERE order_id = $1 AND status = 'HELD'`,
      [orderId]
    );

    for (const row of reservations.rows) {
      await client.query(
        'UPDATE inventory SET reserved_stock = GREATEST(0, reserved_stock - $1) WHERE product_id = $2',
        [row.quantity, row.product_id]
      );
    }

    await client.query(`UPDATE stock_reservations SET status = 'RELEASED' WHERE order_id = $1`, [orderId]);
    await client.query('COMMIT');
    logger.info(`Compensating transaction: released stock for failed order ${orderId}`, { correlationId });
  } catch (err: any) {
    await client.query('ROLLBACK');
    logger.error(`Failed to release stock for order ${orderId}`, { correlationId }, err as Error);
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
    res.json({ status: 'READY', service: config.serviceName, rabbitmq: channel ? 'CONNECTED' : 'DISCONNECTED' });
  } catch {
    res.status(503).json({ status: 'NOT_READY' });
  }
});

// Seed or update stock
app.post('/inventory/stock', async (req, res, next) => {
  try {
    const { productId, totalStock } = req.body;
    if (!productId || totalStock === undefined) throw new AppError('productId and totalStock are required', 400);

    const result = await pool.query(
      `INSERT INTO inventory (product_id, total_stock, reserved_stock, updated_at)
       VALUES ($1, $2, 0, NOW())
       ON CONFLICT (product_id) DO UPDATE SET total_stock = EXCLUDED.total_stock, updated_at = NOW()
       RETURNING *`,
      [productId, totalStock]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

app.use(createErrorHandler(logger));

const server = app.listen(config.port, () => {
  logger.info(`${config.serviceName} listening on port ${config.port}`);
  initRabbitMQ();
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
