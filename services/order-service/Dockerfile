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
RUN npm run build --workspace=@enterprise/order-service

FROM node:20-alpine AS runner

WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY package.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/shared ./shared
COPY --from=builder /usr/src/app/services/order-service/dist ./services/order-service/dist
COPY --from=builder /usr/src/app/services/order-service/package.json ./services/order-service/package.json

USER node

EXPOSE 5004

CMD ["node", "services/order-service/dist/index.js"]
