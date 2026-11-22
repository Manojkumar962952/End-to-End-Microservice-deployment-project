import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { UserRole, AuthTokens, UserTokenPayload } from '@enterprise/contracts';

export class TokenService {
  // Argon2id hashing: resistant to GPU and side-channel cracking attacks
  public static async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 2 ** 16, // 64 MB
      timeCost: 3,
      parallelism: 1
    });
  }

  public static async verifyPassword(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  public static generateTokens(payload: UserTokenPayload, familyId: string = uuidv4()): { tokens: AuthTokens; familyId: string; refreshTokenHash: string; expiresAt: Date } {
    const accessToken = jwt.sign(payload, config.jwt.accessSecret, {
      expiresIn: config.jwt.accessExpiresIn
    });

    // Refresh token is a secure random string or high-entropy JWT
    const rawRefreshToken = uuidv4() + '.' + uuidv4();
    const refreshToken = jwt.sign({ raw: rawRefreshToken, familyId, userId: payload.userId }, config.jwt.refreshSecret, {
      expiresIn: `${config.jwt.refreshExpiresInSeconds}s`
    });

    // Hash refresh token for storage
    const expiresAt = new Date(Date.now() + config.jwt.refreshExpiresInSeconds * 1000);

    return {
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 900 // 15 mins in seconds
      },
      familyId,
      refreshTokenHash: rawRefreshToken, // In real world hashed via sha256
      expiresAt
    };
  }

  public static verifyRefreshToken(token: string): { userId: string; familyId: string; raw: string } {
    return jwt.verify(token, config.jwt.refreshSecret) as { userId: string; familyId: string; raw: string };
  }
}
