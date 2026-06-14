FROM node:20-alpine AS builder
WORKDIR /app
COPY packages/shared ./packages/shared
COPY packages/service-common ./packages/service-common
COPY services/casino-service ./services/casino-service
RUN cd packages/shared && npm install && npm run build
RUN cd packages/service-common && npm install && npm run build
WORKDIR /app/services/casino-service
RUN npm install
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/services/casino-service/dist ./dist
COPY --from=builder /app/services/casino-service/node_modules ./node_modules
COPY --from=builder /app/services/casino-service/package.json ./
COPY --from=builder /app/services/${name}/prisma ./prisma
ENV NODE_ENV=production
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
