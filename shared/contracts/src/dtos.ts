import { z } from 'zod';

export const UserRoleSchema = z.enum(['CUSTOMER', 'ADMIN', 'SERVICE']);
export type UserRole = z.infer<typeof UserRoleSchema>;

// Auth DTOs
export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  firstName: z.string().min(1),
  lastName: z.string().min(1)
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UserTokenPayload {
  userId: string;
  email: string;
  role: UserRole;
}

// Product DTOs
export interface ProductDto {
  id: string;
  name: string;
  slug: string;
  description: string;
  priceCents: number;
  currency: string;
  categoryName?: string;
  isActive: boolean;
}

// Order DTOs
export const CreateOrderRequestSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().positive()
    })
  ).min(1, 'Order must contain at least one item')
});
export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;

export type OrderStatus = 'PENDING' | 'RESERVED' | 'CONFIRMED' | 'FAILED' | 'CANCELLED';

export interface OrderDto {
  id: string;
  customerId: string;
  status: OrderStatus;
  totalCents: number;
  currency: string;
  idempotencyKey: string;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPriceCents: number;
  }>;
  createdAt: string;
}
