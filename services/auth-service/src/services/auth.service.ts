import { pool } from '../db';
import { TokenService } from './token.service';
import { RegisterRequest, LoginRequest, AuthTokens, UserRole } from '@enterprise/contracts';
import { AppError } from '@enterprise/middleware';
import { v4 as uuidv4 } from 'uuid';

export class AuthService {
  public static async register(data: RegisterRequest): Promise<{ userId: string; email: string }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query('SELECT id FROM users_auth WHERE email = $1', [data.email.toLowerCase()]);
      if (existing.rows.length > 0) {
        throw new AppError('Email is already registered', 409, 'EMAIL_EXISTS');
      }

      const passwordHash = await TokenService.hashPassword(data.password);
      const res = await client.query(
        `INSERT INTO users_auth (email, password_hash, role)
         VALUES ($1, $2, 'CUSTOMER')
         RETURNING id, email`,
        [data.email.toLowerCase(), passwordHash]
      );

      await client.query('COMMIT');
      return {
        userId: res.rows[0].id,
        email: res.rows[0].email
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public static async login(data: LoginRequest): Promise<AuthTokens> {
    const res = await pool.query(
      `SELECT id, email, password_hash, role, is_active FROM users_auth WHERE email = $1`,
      [data.email.toLowerCase()]
    );

    if (res.rows.length === 0) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const user = res.rows[0];
    if (!user.is_active) {
      throw new AppError('Account is disabled', 403, 'ACCOUNT_DISABLED');
    }

    const isValid = await TokenService.verifyPassword(user.password_hash, data.password);
    if (!isValid) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const familyId = uuidv4();
    const { tokens, refreshTokenHash, expiresAt } = TokenService.generateTokens(
      { userId: user.id, email: user.email, role: user.role as UserRole },
      familyId
    );

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [user.id, refreshTokenHash, familyId, expiresAt]
    );

    return tokens;
  }

  public static async refresh(refreshTokenString: string): Promise<AuthTokens> {
    let decoded: { userId: string; familyId: string; raw: string };
    try {
      decoded = TokenService.verifyRefreshToken(refreshTokenString);
    } catch {
      throw new AppError('Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const tokenRecord = await client.query(
        `SELECT id, is_revoked, expires_at FROM refresh_tokens 
         WHERE family_id = $1 AND token_hash = $2`,
        [decoded.familyId, decoded.raw]
      );

      // Refresh Token Rotation Security Check:
      // If the token is not found or is revoked, someone may be replaying an old token!
      // Invalidate the ENTIRE token family immediately.
      if (tokenRecord.rows.length === 0 || tokenRecord.rows[0].is_revoked) {
        await client.query('UPDATE refresh_tokens SET is_revoked = true WHERE family_id = $1', [decoded.familyId]);
        await client.query('COMMIT');
        throw new AppError('Suspicious token activity detected. Session invalidated.', 401, 'TOKEN_REUSE_DETECTED');
      }

      if (new Date() > new Date(tokenRecord.rows[0].expires_at)) {
        throw new AppError('Refresh token expired', 401, 'REFRESH_TOKEN_EXPIRED');
      }

      // Mark the current token as used/revoked
      await client.query('UPDATE refresh_tokens SET is_revoked = true WHERE id = $1', [tokenRecord.rows[0].id]);

      // Fetch user details
      const userRes = await client.query('SELECT id, email, role, is_active FROM users_auth WHERE id = $1', [decoded.userId]);
      if (userRes.rows.length === 0 || !userRes.rows[0].is_active) {
        throw new AppError('User not found or inactive', 401, 'USER_INACTIVE');
      }
      const user = userRes.rows[0];

      // Issue new token in the same family
      const { tokens, refreshTokenHash, expiresAt } = TokenService.generateTokens(
        { userId: user.id, email: user.email, role: user.role as UserRole },
        decoded.familyId
      );

      await client.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [user.id, refreshTokenHash, decoded.familyId, expiresAt]
      );

      await client.query('COMMIT');
      return tokens;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public static async logout(refreshTokenString: string): Promise<void> {
    try {
      const decoded = TokenService.verifyRefreshToken(refreshTokenString);
      await pool.query('UPDATE refresh_tokens SET is_revoked = true WHERE family_id = $1', [decoded.familyId]);
    } catch {
      // Idempotent logout - succeed even if token already invalid
    }
  }
}
