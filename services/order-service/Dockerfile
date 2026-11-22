# Multi-Stage Dockerfile for Order Service
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package.json ./
COPY shared ./shared
COPY services/order-service ./services/order-service

RUN npm install
RUN npm run build --workspace=@enterprise/contracts
RUN npm run build --workspace=@enterprise/logger
RUN npm run build --workspace=@enterprise/middleware
RUN npm run build --workspace=@enterprise/order-service

FROM node:20-alpine AS runner

WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY package.json ./
COPY shared ./shared
COPY services/order-service ./services/order-service

RUN npm install --omit=dev
RUN npm run build --workspace=@enterprise/contracts
RUN npm run build --workspace=@enterprise/logger
RUN npm run build --workspace=@enterprise/middleware
RUN npm run build --workspace=@enterprise/order-service

COPY --from=builder /usr/src/app/services/order-service/dist ./services/order-service/dist

USER node

EXPOSE 5004

CMD ["node", "services/order-service/dist/index.js"]
