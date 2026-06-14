#!/usr/bin/env node
const services = [
  'auth-service', 'wallet-service', 'catalog-service', 'odds-service',
  'sportsbook-service', 'settlement-service', 'casino-service', 'promotions-service',
  'notification-service', 'kyc-service', 'cms-service', 'support-service',
  'compliance-service', 'live-service', 'file-service', 'api-gateway',
];

const template = (name) => `FROM node:20-alpine AS builder
WORKDIR /app
COPY packages/shared ./packages/shared
COPY packages/service-common ./packages/service-common
COPY services/${name} ./services/${name}
RUN cd packages/shared && npm install && npm run build
RUN cd packages/service-common && npm install && npm run build
WORKDIR /app/services/${name}
RUN npm install
${name !== 'file-service' && name !== 'settlement-service' && name !== 'api-gateway' ? 'RUN npx prisma generate' : ''}
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/services/${name}/dist ./dist
COPY --from=builder /app/services/${name}/node_modules ./node_modules
COPY --from=builder /app/services/${name}/package.json ./
${name !== 'file-service' && name !== 'settlement-service' && name !== 'api-gateway' ? 'COPY --from=builder /app/services/${name}/prisma ./prisma' : ''}
ENV NODE_ENV=production
CMD ["sh", "-c", "${name !== 'file-service' && name !== 'settlement-service' && name !== 'api-gateway' ? 'npx prisma db push --skip-generate && ' : ''}node dist/index.js"]
`;

const fs = require('fs');
const path = require('path');
for (const s of services) {
  const out = path.join(__dirname, '..', 'services', s, 'Dockerfile');
  fs.writeFileSync(out, template(s));
  console.log('Dockerfile:', s);
}
