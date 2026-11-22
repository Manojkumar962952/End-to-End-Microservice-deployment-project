import { Request, Response, NextFunction } from 'express';
import { ApiErrorResponse } from '@enterprise/contracts';
import { Logger } from '@enterprise/logger';

export class AppError extends Error {
  public statusCode: number;
  public code: string;
  public details?: unknown;

  constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_ERROR', details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const createErrorHandler = (logger: Logger) => {
  return (err: Error, req: Request, res: Response, _next: NextFunction): void => {
    const correlationId = req.correlationId || 'unknown';

    if (err instanceof AppError) {
      logger.warn(`Operational Error: ${err.message}`, { correlationId, code: err.code, statusCode: err.statusCode });
      const response: ApiErrorResponse = {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          details: err.details
        },
        meta: {
          correlationId,
          timestamp: new Date().toISOString()
        }
      };
      res.status(err.statusCode).json(response);
      return;
    }

    // Unhandled exception
    logger.error(`Unhandled Exception: ${err.message}`, { correlationId }, err);
    const response: ApiErrorResponse = {
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred. Please contact support with correlation ID.'
      },
      meta: {
        correlationId,
        timestamp: new Date().toISOString()
      }
    };
    res.status(500).json(response);
  };
};
