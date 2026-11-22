import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Pool } from 'pg';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import { z } from 'zod';
import { createLogger } from '@enterprise/logger';
import { correlationIdMiddleware, createErrorHandler, AppError } from '@enterprise/middleware';
import { ApiResponse, ProductDto } from '@enterprise/contracts';

dotenv.config();

const config = {
  serviceName: 'product-service',
  port: parseInt(process.env.PORT || '5003', 10),
  db: {
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres_secret',
    database: process.env.DB_NAME || 'ecommerce_product'
  },
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined
  }
};

const logger = createLogger(config.serviceName);
const pool = new Pool(config.db);
const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  lazyConnect: true,
  maxRetriesPerRequest: 1
});
redis.connect().catch(() => logger.warn('Redis unavailable in product service, running without cache'));

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(correlationIdMiddleware);

// Probes
app.get('/health/live', (_req, res) => res.json({ status: 'UP', service: config.serviceName }));
app.get('/health/ready', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'READY', service: config.serviceName });
  } catch {
    res.status(503).json({ status: 'NOT_READY', service: config.serviceName });
  }
});

// GET /products (Cached in Redis)
app.get('/products', async (req, res, next) => {
  const correlationId = req.correlationId;
  const cacheKey = 'products:all';

  try {
    if (redis.status === 'ready') {
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.debug('Product list served from Redis cache', { correlationId });
        return res.json({
          success: true,
          data: JSON.parse(cached),
          meta: { correlationId, timestamp: new Date().toISOString(), source: 'cache' }
        });
      }
    }

    const query = `
      SELECT p.id, p.name, p.slug, p.description, p.price_cents, p.currency, p.is_active, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = true
      ORDER BY p.created_at DESC
    `;
    const result = await pool.query(query);
    const products: ProductDto[] = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      priceCents: row.price_cents,
      currency: row.currency,
      categoryName: row.category_name,
      isActive: row.is_active
    }));

    if (redis.status === 'ready') {
      await redis.set(cacheKey, JSON.stringify(products), 'EX', 300); // 5 min TTL
    }

    const response: ApiResponse<ProductDto[]> = {
      success: true,
      data: products,
      meta: { correlationId, timestamp: new Date().toISOString(), source: 'db' }
    };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

// GET /products/:id
app.get('/products/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const query = `
      SELECT p.id, p.name, p.slug, p.description, p.price_cents, p.currency, p.is_active, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = $1
    `;
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    }

    const row = result.rows[0];
    const product: ProductDto = {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      priceCents: row.price_cents,
      currency: row.currency,
      categoryName: row.category_name,
      isActive: row.is_active
    };

    res.json({
      success: true,
      data: product,
      meta: { correlationId: req.correlationId, timestamp: new Date().toISOString() }
    });
  } catch (err) {
    next(err);
  }
});

// POST /products (Admin Only)
const CreateProductSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().default('USD')
});

app.post('/products', async (req, res, next) => {
  try {
    const role = req.headers['x-user-role'] as string;
    if (role !== 'ADMIN') {
      throw new AppError('Forbidden: Admin access required', 403, 'FORBIDDEN');
    }

    const parsed = CreateProductSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Invalid payload', 400, 'VALIDATION_ERROR', parsed.error.format());
    }

    const { name, slug, description, priceCents, currency } = parsed.data;
    const query = `
      INSERT INTO products (name, slug, description, price_cents, currency)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, slug, description, price_cents, currency, is_active
    `;
    const result = await pool.query(query, [name, slug, description || '', priceCents, currency]);

    // Invalidate product cache
    if (redis.status === 'ready') {
      await redis.del('products:all');
    }

    res.status(201).json({
      success: true,
      data: result.rows[0],
      meta: { correlationId: req.correlationId, timestamp: new Date().toISOString() }
    });
  } catch (err) {
    next(err);
  }
});

app.use(createErrorHandler(logger));

const server = app.listen(config.port, () => {
  logger.info(`${config.serviceName} listening on port ${config.port}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
