import Redis from 'ioredis';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { createLogger } from '@enterprise/logger';

const logger = createLogger('rate-limiter');

let redisClient: Redis | null = null;
try {
  redisClient = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    retryStrategy: (times) => Math.min(times * 100, 3000),
    maxRetriesPerRequest: 1,
    lazyConnect: true
  });
  redisClient.connect().catch(() => {
    logger.warn('Redis connection failed; rate limiter falling back to in-memory mode.');
  });
} catch {
  logger.warn('Redis client initialization failed; using in-memory rate limiting.');
}

// In-memory fallback map if Redis is temporarily unreachable
const inMemoryStore = new Map<string, { count: number; resetAt: number }>();

export const createRateLimiter = (limit: number = 60, windowSeconds: number = 60) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown-client';
    const key = `ratelimit:${req.baseUrl || ''}${req.path}:${clientIp}`;

    try {
      if (redisClient && redisClient.status === 'ready') {
        const current = await redisClient.incr(key);
        if (current === 1) {
          await redisClient.expire(key, windowSeconds);
        }

        res.setHeader('X-RateLimit-Limit', limit);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - current));

        if (current > limit) {
          res.status(429).json({
            success: false,
            error: {
              code: 'TOO_MANY_REQUESTS',
              message: `Rate limit exceeded. Maximum ${limit} requests per ${windowSeconds}s.`
            },
            meta: { correlationId: req.correlationId, timestamp: new Date().toISOString() }
          });
          return;
        }
        return next();
      }
    } catch {
      // Redis error fallback
    }

    // In-memory fallback
    const now = Date.now();
    const entry = inMemoryStore.get(key);
    if (!entry || now > entry.resetAt) {
      inMemoryStore.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return next();
    }

    entry.count++;
    if (entry.count > limit) {
      res.status(429).json({
        success: false,
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: `Rate limit exceeded (in-memory). Maximum ${limit} requests per ${windowSeconds}s.`
        },
        meta: { correlationId: req.correlationId, timestamp: new Date().toISOString() }
      });
      return;
    }

    next();
  };
};
