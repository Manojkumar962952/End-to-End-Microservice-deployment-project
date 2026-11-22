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
RUN npm run build --workspace=@enterprise/product-service

FROM node:20-alpine AS runner

WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY package.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/shared ./shared
COPY --from=builder /usr/src/app/services/product-service/dist ./services/product-service/dist
COPY --from=builder /usr/src/app/services/product-service/package.json ./services/product-service/package.json

USER node

EXPOSE 5003

CMD ["node", "services/product-service/dist/index.js"]
