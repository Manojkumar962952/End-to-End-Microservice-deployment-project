import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { config } from './config';
import { createRateLimiter } from './middleware/rate-limiter';
import { requireAuth } from './middleware/auth-check';
import { createLogger } from '@enterprise/logger';
import { correlationIdMiddleware } from '@enterprise/middleware';

const logger = createLogger(config.serviceName);
const app = express();

app.use(helmet());
app.use(cors());
app.use(correlationIdMiddleware);

// Health Probes
app.get('/health/live', (_req, res) => {
  res.status(200).json({ status: 'UP', service: config.serviceName, timestamp: new Date().toISOString() });
});

app.get('/health/ready', (_req, res) => {
  res.status(200).json({ status: 'READY', service: config.serviceName });
});

// Helper proxy factory with correlation ID propagation and timeout
const createServiceProxy = (target: string, pathRewrite?: Record<string, string>) => {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    timeout: 10000,
    proxyTimeout: 10000,
    pathRewrite,
    onProxyReq: (proxyReq, req) => {
      if (req.correlationId) {
        proxyReq.setHeader('x-correlation-id', req.correlationId);
      }
      if (req.headers['x-user-id']) {
        proxyReq.setHeader('x-user-id', req.headers['x-user-id'] as string);
        proxyReq.setHeader('x-user-email', req.headers['x-user-email'] as string);
        proxyReq.setHeader('x-user-role', req.headers['x-user-role'] as string);
      }
    },
    onError: (err, _req, res) => {
      logger.error(`Proxy forwarding error to ${target}`, undefined, err);
      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: 'Target microservice is temporarily unavailable.' }
        });
      }
    }
  });
};

// 1. Auth Service Routes
app.use(
  '/api/v1/auth',
  createRateLimiter(30, 60),
  createServiceProxy(config.services.auth, { '^/api/v1/auth': '' })
);

// 2. User Service Routes (Protected)
app.use(
  '/api/v1/users',
  requireAuth,
  createRateLimiter(60, 60),
  createServiceProxy(config.services.user, { '^/api/v1/users': '' })
);

// 3. Product Service Routes (Public catalog)
app.use(
  '/api/v1/products',
  createRateLimiter(120, 60),
  createServiceProxy(config.services.product, { '^/api/v1/products': '/products' })
);

// 4. Order Service Routes (Protected)
app.use(
  '/api/v1/orders',
  requireAuth,
  createRateLimiter(40, 60),
  createServiceProxy(config.services.order, { '^/api/v1/orders': '/orders' })
);

// 5. Payment Service Routes (Protected)
app.use(
  '/api/v1/payments',
  requireAuth,
  createRateLimiter(20, 60),
  createServiceProxy(config.services.payment, { '^/api/v1/payments': '/payments' })
);

// 6. Inventory Service Routes (Internal or Admin)
app.use(
  '/api/v1/inventory',
  requireAuth,
  createRateLimiter(60, 60),
  createServiceProxy(config.services.inventory, { '^/api/v1/inventory': '/inventory' })
);

// Catch-all 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} not found on API Gateway.` },
    meta: { correlationId: req.correlationId, timestamp: new Date().toISOString() }
  });
});

const server = app.listen(config.port, () => {
  logger.info(`API Gateway active and listening on port ${config.port}`);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Gracefully shutting down API Gateway...');
  server.close(() => process.exit(0));
});
