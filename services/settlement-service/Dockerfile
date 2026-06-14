FROM node:20-alpine AS builder
WORKDIR /app
COPY packages/shared ./packages/shared
COPY packages/service-common ./packages/service-common
COPY services/settlement-service ./services/settlement-service
RUN cd packages/shared && npm install && npm run build
RUN cd packages/service-common && npm install && npm run build
WORKDIR /app/services/settlement-service
RUN npm install

RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/services/settlement-service/dist ./dist
COPY --from=builder /app/services/settlement-service/node_modules ./node_modules
COPY --from=builder /app/services/settlement-service/package.json ./

ENV NODE_ENV=production
CMD ["sh", "-c", "node dist/index.js"]
