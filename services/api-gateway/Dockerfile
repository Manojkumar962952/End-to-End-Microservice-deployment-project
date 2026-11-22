# Multi-Stage Dockerfile for API Gateway
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package.json ./
COPY shared ./shared
COPY services/api-gateway ./services/api-gateway

RUN npm install
RUN npm run build --workspace=@enterprise/contracts
RUN npm run build --workspace=@enterprise/logger
RUN npm run build --workspace=@enterprise/middleware
RUN npm run build --workspace=@enterprise/api-gateway

FROM node:20-alpine AS runner

WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY package.json ./
COPY shared ./shared
COPY services/api-gateway ./services/api-gateway

RUN npm install --omit=dev
RUN npm run build --workspace=@enterprise/contracts
RUN npm run build --workspace=@enterprise/logger
RUN npm run build --workspace=@enterprise/middleware
RUN npm run build --workspace=@enterprise/api-gateway

COPY --from=builder /usr/src/app/services/api-gateway/dist ./services/api-gateway/dist

USER node

EXPOSE 8000

CMD ["node", "services/api-gateway/dist/index.js"]
