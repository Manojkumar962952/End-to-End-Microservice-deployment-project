import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Pool } from 'pg';
import amqplib from 'amqplib';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '@enterprise/logger';
import { correlationIdMiddleware, createErrorHandler, AppError } from '@enterprise/middleware';
import { EventTypes, CreateOrderRequestSchema, ApiResponse, OrderDto } from '@enterprise/contracts';

dotenv.config();

const config = {
  serviceName: 'order-service',
  port: parseInt(process.env.PORT || '5004', 10),
  db: {
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres_secret',
    database: process.env.DB_NAME || 'ecommerce_order'
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

    const q = await ch.assertQueue('order.lifecycle.updates', { durable: true });
    await ch.bindQueue(q.queue, EXCHANGE, EventTypes.INVENTORY_FAILED);
    await ch.bindQueue(q.queue, EXCHANGE, EventTypes.PAYMENT_SUCCEEDED);
    await ch.bindQueue(q.queue, EXCHANGE, EventTypes.PAYMENT_FAILED);

    logger.info('Order service connected to RabbitMQ.');

    ch.consume(q.queue, async (msg: any) => {
      if (!msg) return;
      const content = JSON.parse(msg.content.toString());
      const routingKey = msg.fields.routingKey;

      if (routingKey === EventTypes.INVENTORY_FAILED || routingKey === EventTypes.PAYMENT_FAILED) {
        await pool.query(`UPDATE orders SET status = 'FAILED', updated_at = NOW() WHERE id = $1`, [content.payload.orderId]);
        logger.info(`Order ${content.payload.orderId} marked as FAILED`);
      } else if (routingKey === EventTypes.PAYMENT_SUCCEEDED) {
        await pool.query(`UPDATE orders SET status = 'CONFIRMED', updated_at = NOW() WHERE id = $1`, [content.payload.orderId]);
        logger.info(`Order ${content.payload.orderId} marked as CONFIRMED`);
      }

      ch.ack(msg);
    });
  } catch (err: any) {
    logger.warn('RabbitMQ connection retry in 5s...', undefined, err as Error);
    setTimeout(initRabbitMQ, 5000);
  }
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

// POST /orders (Create order and trigger checkout saga)
app.post('/orders', async (req, res, next) => {
  const correlationId = req.correlationId;
  const customerId = req.headers['x-user-id'] as string;
  const idempotencyKey = (req.headers['idempotency-key'] as string) || uuidv4();

  if (!customerId) throw new AppError('Unauthorized', 401);

  const parsed = CreateOrderRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Invalid order payload', 400, 'VALIDATION_ERROR', parsed.error.format());
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotency check: if order exists with this key, return it
    const existing = await client.query('SELECT * FROM orders WHERE idempotency_key = $1', [idempotencyKey]);
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      res.status(200).json({
        success: true,
        data: existing.rows[0],
        meta: { correlationId, timestamp: new Date().toISOString(), duplicate: true }
      });
      return;
    }

    // Fixed dummy price calculation per item for simulation
    const unitPriceCents = 2500; // $25.00
    let totalCents = 0;
    for (const item of parsed.data.items) {
      totalCents += item.quantity * unitPriceCents;
    }

    const orderRes = await client.query(
      `INSERT INTO orders (customer_id, status, total_cents, currency, idempotency_key)
       VALUES ($1, 'PENDING', $2, 'USD', $3)
       RETURNING *`,
      [customerId, totalCents, idempotencyKey]
    );

    const order = orderRes.rows[0];

    for (const item of parsed.data.items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price_cents)
         VALUES ($1, $2, 'Enterprise Product', $3, $4)`,
        [order.id, item.productId, item.quantity, unitPriceCents]
      );
    }

    await client.query('COMMIT');

    // Publish OrderCreatedEvent to RabbitMQ
    if (channel) {
      const event = {
        eventId: uuidv4(),
        eventType: EventTypes.ORDER_CREATED,
        timestamp: new Date().toISOString(),
        correlationId,
        payload: {
          orderId: order.id,
          customerId,
          items: parsed.data.items,
          totalCents,
          currency: 'USD'
        }
      };
      channel.publish(EXCHANGE, EventTypes.ORDER_CREATED, Buffer.from(JSON.stringify(event)), { persistent: true });
      logger.info(`Published ${EventTypes.ORDER_CREATED} for order ${order.id}`, { correlationId });
    }

    const response: ApiResponse<typeof order> = {
      success: true,
      data: order,
      meta: { correlationId, timestamp: new Date().toISOString() }
    };
    res.status(202).json(response);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// GET /orders (Customer order history)
app.get('/orders', async (req, res, next) => {
  const customerId = req.headers['x-user-id'] as string;
  if (!customerId) throw new AppError('Unauthorized', 401);

  try {
    const ordersRes = await pool.query(
      `SELECT o.*, 
        COALESCE(json_agg(json_build_object('productId', oi.product_id, 'productName', oi.product_name, 'quantity', oi.quantity, 'unitPriceCents', oi.unit_price_cents)) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       WHERE o.customer_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [customerId]
    );

    const response: ApiResponse<any[]> = {
      success: true,
      data: ordersRes.rows,
      meta: { correlationId: req.correlationId, timestamp: new Date().toISOString() }
    };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

// GET /orders/:id (Specific order details)
app.get('/orders/:id', async (req, res, next) => {
  const customerId = req.headers['x-user-id'] as string;
  const { id } = req.params;
  if (!customerId) throw new AppError('Unauthorized', 401);

  try {
    const ordersRes = await pool.query(
      `SELECT o.*, 
        COALESCE(json_agg(json_build_object('productId', oi.product_id, 'productName', oi.product_name, 'quantity', oi.quantity, 'unitPriceCents', oi.unit_price_cents)) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       WHERE o.id = $1 AND o.customer_id = $2
       GROUP BY o.id`,
      [id, customerId]
    );

    if (ordersRes.rows.length === 0) {
      throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
    }

    res.json({
      success: true,
      data: ordersRes.rows[0],
      meta: { correlationId: req.correlationId, timestamp: new Date().toISOString() }
    });
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
