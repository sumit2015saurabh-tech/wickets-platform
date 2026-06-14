#!/usr/bin/env node
/**
 * Generates a standard Dockerfile for a wickets microservice.
 * Usage: node scripts/generate-dockerfile.js auth-service
 */
const fs = require('fs');
const path = require('path');

const service = process.argv[2];
if (!service) {
  console.error('Usage: node generate-dockerfile.js <service-name>');
  process.exit(1);
}

const dockerfile = `FROM node:20-alpine AS builder
WORKDIR /app
COPY packages/shared ./packages/shared
COPY packages/service-common ./packages/service-common
COPY services/${service} ./services/${service}
RUN cd packages/shared && npm install && npm run build
RUN cd packages/service-common && npm install && npm run build
WORKDIR /app/services/${service}
RUN npm install
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/services/${service}/dist ./dist
COPY --from=builder /app/services/${service}/node_modules ./node_modules
COPY --from=builder /app/services/${service}/package.json ./
COPY --from=builder /app/services/${service}/prisma ./prisma
ENV NODE_ENV=production
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
`;

const out = path.join(__dirname, '..', 'services', service, 'Dockerfile');
fs.writeFileSync(out, dockerfile);
console.log('Wrote', out);
