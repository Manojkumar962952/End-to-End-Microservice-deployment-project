import { Pool } from 'pg';
import { config } from './config';
import { createLogger } from '@enterprise/logger';

const logger = createLogger(config.serviceName);

export const pool = new Pool(config.db);

pool.on('error', (err) => {
  logger.error('Unexpected error on idle PostgreSQL client pool', undefined, err);
});

export const checkDatabaseHealth = async (): Promise<boolean> => {
  try {
    const res = await pool.query('SELECT 1 AS healthy');
    return res.rows[0]?.healthy === 1;
  } catch (err) {
    logger.error('PostgreSQL healthcheck query failed', undefined, err as Error);
    return false;
  }
};
