FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package.json ./
COPY frontend ./frontend

RUN npm install --workspace=@enterprise/frontend
RUN npm run build --workspace=@enterprise/frontend

FROM nginx:alpine AS runner

COPY --from=builder /usr/src/app/frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
