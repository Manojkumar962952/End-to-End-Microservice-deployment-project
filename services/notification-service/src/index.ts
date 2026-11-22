import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Pool } from 'pg';
import amqplib from 'amqplib';
import dotenv from 'dotenv';
import { createLogger } from '@enterprise/logger';
import { correlationIdMiddleware, createErrorHandler } from '@enterprise/middleware';

dotenv.config();

const config = {
  serviceName: 'notification-service',
  port: parseInt(process.env.PORT || '5007', 10),
  db: {
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres_secret',
    database: process.env.DB_NAME || 'ecommerce_notification'
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

    const q = await ch.assertQueue('notification.events.log', { durable: true });
    await ch.bindQueue(q.queue, EXCHANGE, 'order.*');
    await ch.bindQueue(q.queue, EXCHANGE, 'payment.*');
    await ch.bindQueue(q.queue, EXCHANGE, 'inventory.*');

    logger.info('Notification service listening on topic queue.');

    ch.consume(q.queue, async (msg: any) => {
      if (!msg) return;
      const content = JSON.parse(msg.content.toString());
      const routingKey = msg.fields.routingKey;

      try {
        await pool.query(
          `INSERT INTO notification_logs (recipient_email, notification_type, correlation_id, payload, status)
           VALUES ($1, $2, $3, $4, 'SENT')`,
          ['customer@enterprise.example', routingKey, content.correlationId || null, JSON.stringify(content.payload)]
        );
        logger.info(`Notification recorded for event ${routingKey}`, { correlationId: content.correlationId });
      } catch (err: any) {
        logger.error(`Failed to log notification for event ${routingKey}`, undefined, err as Error);
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

app.get('/notifications', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM notification_logs ORDER BY sent_at DESC LIMIT 50');
    res.json({ success: true, data: result.rows, meta: { correlationId: req.correlationId } });
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
