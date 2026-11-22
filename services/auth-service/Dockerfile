# Multi-Stage Dockerfile for Auth Service
# 1. Builder Stage
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Copy root monorepo files for dependency context
COPY package.json ./
COPY shared ./shared
COPY services/auth-service ./services/auth-service

# Install dependencies and build shared libraries + service
RUN npm install
RUN npm run build --workspace=@enterprise/contracts
RUN npm run build --workspace=@enterprise/logger
RUN npm run build --workspace=@enterprise/middleware
RUN npm run build --workspace=@enterprise/auth-service

# 2. Production Runtime Stage
FROM node:20-alpine AS runner

WORKDIR /usr/src/app
ENV NODE_ENV=production

# Install only production dependencies
COPY package.json ./
COPY shared ./shared
COPY services/auth-service ./services/auth-service

RUN npm install --omit=dev
RUN npm run build --workspace=@enterprise/contracts
RUN npm run build --workspace=@enterprise/logger
RUN npm run build --workspace=@enterprise/middleware
RUN npm run build --workspace=@enterprise/auth-service

# Copy compiled artifacts from builder
COPY --from=builder /usr/src/app/services/auth-service/dist ./services/auth-service/dist

# Non-root user security requirement
USER node

EXPOSE 5001

CMD ["node", "services/auth-service/dist/index.js"]
