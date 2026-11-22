import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config';
import { authRouter } from './routes/auth.routes';
import { checkDatabaseHealth } from './db';
import { createLogger } from '@enterprise/logger';
import { correlationIdMiddleware, createErrorHandler } from '@enterprise/middleware';

const logger = createLogger(config.serviceName);
const app = express();

// Security & Parsing Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(correlationIdMiddleware);

// Health Probes for Kubernetes / Docker / AWS
app.get('/health/live', (_req, res) => {
  res.status(200).json({ status: 'UP', service: config.serviceName, timestamp: new Date().toISOString() });
});

app.get('/health/ready', async (_req, res) => {
  const dbOk = await checkDatabaseHealth();
  if (dbOk) {
    res.status(200).json({ status: 'READY', service: config.serviceName, db: 'CONNECTED' });
  } else {
    res.status(503).json({ status: 'NOT_READY', service: config.serviceName, db: 'DISCONNECTED' });
  }
});

// Mount Routes
app.use('/', authRouter);

// Standardized Central Error Handler
app.use(createErrorHandler(logger));

const server = app.listen(config.port, () => {
  logger.info(`${config.serviceName} listening on port ${config.port}`);
});

// Graceful Shutdown Handling (Zero-Downtime requirement)
const gracefulShutdown = (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  server.close(() => {
    logger.info('HTTP server closed. Exiting process.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
