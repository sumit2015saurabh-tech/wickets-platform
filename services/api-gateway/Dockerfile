FROM node:20-alpine AS builder
WORKDIR /app
COPY packages/shared ./packages/shared
COPY packages/service-common ./packages/service-common
COPY services/api-gateway ./services/api-gateway
RUN cd packages/shared && npm install && npm run build
RUN cd packages/service-common && npm install && npm run build
WORKDIR /app/services/api-gateway
RUN npm install

RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/services/api-gateway/dist ./dist
COPY --from=builder /app/services/api-gateway/node_modules ./node_modules
COPY --from=builder /app/services/api-gateway/package.json ./

ENV NODE_ENV=production
CMD ["sh", "-c", "node dist/index.js"]
