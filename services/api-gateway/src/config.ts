import dotenv from 'dotenv';
dotenv.config();

export const config = {
  serviceName: 'api-gateway',
  port: parseInt(process.env.PORT || '8000', 10),
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev_jwt_access_secret_do_not_use_in_prod_12345678'
  },
  services: {
    auth: process.env.AUTH_SERVICE_URL || 'http://auth-service:5001',
    user: process.env.USER_SERVICE_URL || 'http://user-service:5002',
    product: process.env.PRODUCT_SERVICE_URL || 'http://product-service:5003',
    order: process.env.ORDER_SERVICE_URL || 'http://order-service:5004',
    payment: process.env.PAYMENT_SERVICE_URL || 'http://payment-service:5005',
    inventory: process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:5006',
    notification: process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:5007'
  }
};
