import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { AuthTokens, UserTokenPayload } from '@enterprise/contracts';

export class TokenService {
  // Memory-hard key derivation function (scrypt via Node native crypto):
  public static async hashPassword(password: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const salt = crypto.randomBytes(16).toString('hex');
      crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
        if (err) return reject(err);
        resolve(`${salt}:${derivedKey.toString('hex')}`);
      });
    });
  }

  public static async verifyPassword(storedHash: string, plain: string): Promise<boolean> {
    return new Promise((resolve) => {
      const [salt, key] = storedHash.split(':');
      if (!salt || !key) return resolve(false);
      crypto.scrypt(plain, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
        if (err) return resolve(false);
        try {
          const keyBuffer = Buffer.from(key, 'hex');
          resolve(crypto.timingSafeEqual(keyBuffer, derivedKey));
        } catch {
          resolve(false);
        }
      });
    });
  }

  public static generateTokens(payload: UserTokenPayload, familyId: string = uuidv4()): { tokens: AuthTokens; familyId: string; refreshTokenHash: string; expiresAt: Date } {
    const accessToken = jwt.sign(payload, config.jwt.accessSecret, {
      expiresIn: 900 // 15 mins in seconds
    });

    const rawRefreshToken = uuidv4() + '.' + uuidv4();
    const refreshToken = jwt.sign({ raw: rawRefreshToken, familyId, userId: payload.userId }, config.jwt.refreshSecret, {
      expiresIn: config.jwt.refreshExpiresInSeconds
    });

    const expiresAt = new Date(Date.now() + config.jwt.refreshExpiresInSeconds * 1000);

    return {
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 900 // 15 mins
      },
      familyId,
      refreshTokenHash: rawRefreshToken,
      expiresAt
    };
  }

  public static verifyRefreshToken(token: string): { userId: string; familyId: string; raw: string } {
    return jwt.verify(token, config.jwt.refreshSecret) as { userId: string; familyId: string; raw: string };
  }
}
