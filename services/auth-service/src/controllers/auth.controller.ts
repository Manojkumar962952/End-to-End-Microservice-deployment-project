import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { RegisterRequestSchema, LoginRequestSchema, ApiResponse } from '@enterprise/contracts';
import { AppError } from '@enterprise/middleware';
import { z } from 'zod';

export class AuthController {
  public static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = RegisterRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Invalid request payload', 400, 'VALIDATION_ERROR', parsed.error.format());
      }

      const result = await AuthService.register(parsed.data);
      const response: ApiResponse<typeof result> = {
        success: true,
        data: result,
        meta: {
          correlationId: req.correlationId,
          timestamp: new Date().toISOString()
        }
      };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = LoginRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Invalid request payload', 400, 'VALIDATION_ERROR', parsed.error.format());
      }

      const tokens = await AuthService.login(parsed.data);
      const response: ApiResponse<typeof tokens> = {
        success: true,
        data: tokens,
        meta: {
          correlationId: req.correlationId,
          timestamp: new Date().toISOString()
        }
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({ refreshToken: z.string().min(1) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Refresh token is required', 400, 'VALIDATION_ERROR');
      }

      const tokens = await AuthService.refresh(parsed.data.refreshToken);
      const response: ApiResponse<typeof tokens> = {
        success: true,
        data: tokens,
        meta: {
          correlationId: req.correlationId,
          timestamp: new Date().toISOString()
        }
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const refreshToken = req.body.refreshToken as string | undefined;
      if (refreshToken) {
        await AuthService.logout(refreshToken);
      }
      res.status(200).json({
        success: true,
        data: { message: 'Logged out successfully' },
        meta: { correlationId: req.correlationId, timestamp: new Date().toISOString() }
      });
    } catch (err) {
      next(err);
    }
  }
}
