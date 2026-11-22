# Multi-Stage Dockerfile for Inventory Service
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package.json ./
COPY shared ./shared
COPY services/inventory-service ./services/inventory-service

RUN npm install
RUN npm run build --workspace=@enterprise/contracts
RUN npm run build --workspace=@enterprise/logger
RUN npm run build --workspace=@enterprise/middleware
RUN npm run build --workspace=@enterprise/inventory-service

FROM node:20-alpine AS runner

WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY package.json ./
COPY shared ./shared
COPY services/inventory-service ./services/inventory-service

RUN npm install --omit=dev
RUN npm run build --workspace=@enterprise/contracts
RUN npm run build --workspace=@enterprise/logger
RUN npm run build --workspace=@enterprise/middleware
RUN npm run build --workspace=@enterprise/inventory-service

COPY --from=builder /usr/src/app/services/inventory-service/dist ./services/inventory-service/dist

USER node

EXPOSE 5006

CMD ["node", "services/inventory-service/dist/index.js"]
