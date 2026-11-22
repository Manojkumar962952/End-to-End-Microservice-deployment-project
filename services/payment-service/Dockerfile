# Multi-Stage Dockerfile for Payment Service
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package.json ./
COPY shared ./shared
COPY services/payment-service ./services/payment-service

RUN npm install
RUN npm run build --workspace=@enterprise/contracts
RUN npm run build --workspace=@enterprise/logger
RUN npm run build --workspace=@enterprise/middleware
RUN npm run build --workspace=@enterprise/payment-service

FROM node:20-alpine AS runner

WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY package.json ./
COPY shared ./shared
COPY services/payment-service ./services/payment-service

RUN npm install --omit=dev
RUN npm run build --workspace=@enterprise/contracts
RUN npm run build --workspace=@enterprise/logger
RUN npm run build --workspace=@enterprise/middleware
RUN npm run build --workspace=@enterprise/payment-service

COPY --from=builder /usr/src/app/services/payment-service/dist ./services/payment-service/dist

USER node

EXPOSE 5005

CMD ["node", "services/payment-service/dist/index.js"]
