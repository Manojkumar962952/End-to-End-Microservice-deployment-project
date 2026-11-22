# Multi-Stage Dockerfile for User Service
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package.json ./
COPY shared ./shared
COPY services/user-service ./services/user-service

RUN npm install
RUN npm run build --workspace=@enterprise/contracts
RUN npm run build --workspace=@enterprise/logger
RUN npm run build --workspace=@enterprise/middleware
RUN npm run build --workspace=@enterprise/user-service

FROM node:20-alpine AS runner

WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY package.json ./
COPY shared ./shared
COPY services/user-service ./services/user-service

RUN npm install --omit=dev
RUN npm run build --workspace=@enterprise/contracts
RUN npm run build --workspace=@enterprise/logger
RUN npm run build --workspace=@enterprise/middleware
RUN npm run build --workspace=@enterprise/user-service

COPY --from=builder /usr/src/app/services/user-service/dist ./services/user-service/dist

USER node

EXPOSE 5002

CMD ["node", "services/user-service/dist/index.js"]
