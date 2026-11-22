FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package.json ./
COPY shared ./shared
COPY services ./services
COPY frontend ./frontend

RUN npm install
RUN npm run build --workspace=@enterprise/contracts
RUN npm run build --workspace=@enterprise/logger
RUN npm run build --workspace=@enterprise/middleware
RUN npm run build --workspace=@enterprise/notification-service

FROM node:20-alpine AS runner

WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY package.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/shared ./shared
COPY --from=builder /usr/src/app/services/notification-service/dist ./services/notification-service/dist
COPY --from=builder /usr/src/app/services/notification-service/package.json ./services/notification-service/package.json

USER node

EXPOSE 5007

CMD ["node", "services/notification-service/dist/index.js"]
