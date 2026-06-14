FROM node:20-alpine AS builder
WORKDIR /app
COPY packages/shared ./packages/shared
COPY packages/service-common ./packages/service-common
COPY services/live-service ./services/live-service
RUN cd packages/shared && npm install && npm run build
RUN cd packages/service-common && npm install && npm run build
WORKDIR /app/services/live-service
RUN npm install
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/services/live-service/dist ./dist
COPY --from=builder /app/services/live-service/node_modules ./node_modules
COPY --from=builder /app/services/live-service/package.json ./
COPY --from=builder /app/services/${name}/prisma ./prisma
ENV NODE_ENV=production
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
