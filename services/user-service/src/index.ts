import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { z } from 'zod';
import { createLogger } from '@enterprise/logger';
import { correlationIdMiddleware, createErrorHandler, AppError } from '@enterprise/middleware';
import { ApiResponse } from '@enterprise/contracts';

dotenv.config();

const config = {
  serviceName: 'user-service',
  port: parseInt(process.env.PORT || '5002', 10),
  db: {
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres_secret',
    database: process.env.DB_NAME || 'ecommerce_user'
  }
};

const logger = createLogger(config.serviceName);
const pool = new Pool(config.db);
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
    res.status(503).json({ status: 'NOT_READY', service: config.serviceName });
  }
});

// Profile Schema
const UpdateProfileSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  shippingAddress: z.record(z.any()).optional(),
  billingAddress: z.record(z.any()).optional()
});

// GET Profile
app.get('/profile', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) throw new AppError('Unauthorized - Missing user context', 401, 'UNAUTHORIZED');

    const result = await pool.query('SELECT * FROM user_profiles WHERE user_id = $1', [userId]);
    const profile = result.rows[0] || null;

    const response: ApiResponse<typeof profile> = {
      success: true,
      data: profile,
      meta: { correlationId: req.correlationId, timestamp: new Date().toISOString() }
    };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

// PUT Profile
app.put('/profile', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) throw new AppError('Unauthorized - Missing user context', 401, 'UNAUTHORIZED');

    const parsed = UpdateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Validation failed', 400, 'VALIDATION_ERROR', parsed.error.format());
    }

    const { firstName, lastName, phone, shippingAddress, billingAddress } = parsed.data;

    const result = await pool.query(
      `INSERT INTO user_profiles (user_id, first_name, last_name, phone, shipping_address, billing_address, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         phone = EXCLUDED.phone,
         shipping_address = EXCLUDED.shipping_address,
         billing_address = EXCLUDED.billing_address,
         updated_at = NOW()
       RETURNING *`,
      [userId, firstName, lastName, phone || null, JSON.stringify(shippingAddress || {}), JSON.stringify(billingAddress || {})]
    );

    const response: ApiResponse<typeof result.rows[0]> = {
      success: true,
      data: result.rows[0],
      meta: { correlationId: req.correlationId, timestamp: new Date().toISOString() }
    };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

app.use(createErrorHandler(logger));

const server = app.listen(config.port, () => {
  logger.info(`${config.serviceName} listening on port ${config.port}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
