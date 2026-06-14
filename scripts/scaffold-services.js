#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVICES_DIR = path.join(ROOT, 'services');

const PRISMA_HEADER = `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

`;

const schemas = {
  'auth-service': `${PRISMA_HEADER}enum UserRole {
  USER
  ADMIN
}

model User {
  id           String   @id @default(uuid())
  email        String   @unique
  username     String   @unique
  passwordHash String   @map("password_hash")
  role         UserRole @default(USER)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  refreshTokens RefreshToken[]

  @@map("users")
}

model RefreshToken {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  tokenHash String   @map("token_hash")
  expiresAt DateTime @map("expires_at")
  createdAt DateTime @default(now()) @map("created_at")
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("refresh_tokens")
}
`,
  'wallet-service': `${PRISMA_HEADER}enum TransactionType {
  DEPOSIT
  WITHDRAWAL
  BET_STAKE
  BET_PAYOUT
  ADJUSTMENT
}

enum TransactionStatus {
  PENDING
  COMPLETED
  FAILED
  CANCELLED
}

model Wallet {
  id        String   @id @default(uuid())
  userId    String   @unique @map("user_id")
  currency  String   @default("USD")
  balance   Decimal  @default(0) @db.Decimal(18, 2)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  transactions Transaction[]

  @@map("wallets")
}

model Transaction {
  id        String            @id @default(uuid())
  walletId  String            @map("wallet_id")
  type      TransactionType
  amount    Decimal           @db.Decimal(18, 2)
  status    TransactionStatus @default(PENDING)
  reference String?
  metadata  Json?
  createdAt DateTime          @default(now()) @map("created_at")
  wallet    Wallet            @relation(fields: [walletId], references: [id])

  @@index([walletId])
  @@map("transactions")
}
`,
  'catalog-service': `${PRISMA_HEADER}model Sport {
  id        String   @id @default(uuid())
  name      String
  slug      String   @unique
  active    Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at")

  events Event[]

  @@map("sports")
}

model Event {
  id        String   @id @default(uuid())
  sportId   String   @map("sport_id")
  name      String
  startTime DateTime @map("start_time")
  status    String   @default("scheduled")
  createdAt DateTime @default(now()) @map("created_at")
  sport     Sport    @relation(fields: [sportId], references: [id])

  markets Market[]

  @@index([sportId])
  @@map("events")
}

model Market {
  id         String   @id @default(uuid())
  eventId    String   @map("event_id")
  name       String
  marketType String   @map("market_type")
  status     String   @default("open")
  createdAt  DateTime @default(now()) @map("created_at")
  event      Event    @relation(fields: [eventId], references: [id])

  @@index([eventId])
  @@map("markets")
}
`,
  'odds-service': `${PRISMA_HEADER}model OddsSnapshot {
  id         String   @id @default(uuid())
  marketId   String   @map("market_id")
  provider   String
  capturedAt DateTime @default(now()) @map("captured_at")

  prices OddsPrice[]

  @@index([marketId])
  @@map("odds_snapshots")
}

model OddsPrice {
  id           String       @id @default(uuid())
  snapshotId   String       @map("snapshot_id")
  selectionKey String       @map("selection_key")
  decimalOdds  Decimal      @map("decimal_odds") @db.Decimal(10, 4)
  snapshot     OddsSnapshot @relation(fields: [snapshotId], references: [id], onDelete: Cascade)

  @@index([snapshotId])
  @@map("odds_prices")
}
`,
  'sportsbook-service': `${PRISMA_HEADER}enum BetStatus {
  PENDING
  ACCEPTED
  SETTLED
  VOID
  REJECTED
}

model Bet {
  id              String    @id @default(uuid())
  userId          String    @map("user_id")
  stake           Decimal   @db.Decimal(18, 2)
  potentialPayout Decimal?  @map("potential_payout") @db.Decimal(18, 2)
  status          BetStatus @default(PENDING)
  placedAt        DateTime  @default(now()) @map("placed_at")
  settledAt       DateTime? @map("settled_at")

  selections BetSelection[]

  @@index([userId])
  @@map("bets")
}

model BetSelection {
  id           String  @id @default(uuid())
  betId        String  @map("bet_id")
  marketId     String  @map("market_id")
  selectionKey String  @map("selection_key")
  decimalOdds  Decimal @map("decimal_odds") @db.Decimal(10, 4)
  bet          Bet     @relation(fields: [betId], references: [id], onDelete: Cascade)

  @@index([betId])
  @@map("bet_selections")
}
`,
  'settlement-service': `${PRISMA_HEADER}enum SettlementStatus {
  PENDING
  COMPLETED
  FAILED
}

model Settlement {
  id        String           @id @default(uuid())
  betId     String           @unique @map("bet_id")
  status    SettlementStatus @default(PENDING)
  payout    Decimal?         @db.Decimal(18, 2)
  settledAt DateTime?        @map("settled_at")
  createdAt DateTime         @default(now()) @map("created_at")

  @@map("settlements")
}
`,
  'casino-service': `${PRISMA_HEADER}model Game {
  id       String  @id @default(uuid())
  slug     String  @unique
  name     String
  provider String
  active   Boolean @default(true)

  sessions GameSession[]

  @@map("games")
}

model GameSession {
  id        String    @id @default(uuid())
  userId    String    @map("user_id")
  gameId    String    @map("game_id")
  stake     Decimal   @db.Decimal(18, 2)
  result    Decimal?  @db.Decimal(18, 2)
  startedAt DateTime  @default(now()) @map("started_at")
  endedAt   DateTime? @map("ended_at")
  game      Game      @relation(fields: [gameId], references: [id])

  @@index([userId])
  @@map("game_sessions")
}
`,
  'promotions-service': `${PRISMA_HEADER}enum PromotionType {
  DEPOSIT_BONUS
  FREE_BET
  CASHBACK
}

model Promotion {
  id        String        @id @default(uuid())
  code      String        @unique
  name      String
  type      PromotionType
  value     Decimal       @db.Decimal(18, 2)
  active    Boolean       @default(true)
  startsAt  DateTime      @map("starts_at")
  endsAt    DateTime?     @map("ends_at")
  createdAt DateTime      @default(now()) @map("created_at")

  redemptions UserPromotion[]

  @@map("promotions")
}

model UserPromotion {
  id          String    @id @default(uuid())
  userId      String    @map("user_id")
  promotionId String    @map("promotion_id")
  redeemedAt  DateTime  @default(now()) @map("redeemed_at")
  promotion   Promotion @relation(fields: [promotionId], references: [id])

  @@unique([userId, promotionId])
  @@map("user_promotions")
}
`,
  'notification-service': `${PRISMA_HEADER}enum NotificationChannel {
  EMAIL
  SMS
  PUSH
  IN_APP
}

model Notification {
  id        String              @id @default(uuid())
  userId    String              @map("user_id")
  channel   NotificationChannel
  title     String
  body      String
  read      Boolean             @default(false)
  createdAt DateTime            @default(now()) @map("created_at")

  @@index([userId])
  @@map("notifications")
}
`,
  'kyc-service': `${PRISMA_HEADER}enum KycStatus {
  PENDING
  UNDER_REVIEW
  APPROVED
  REJECTED
}

model KycSubmission {
  id          String    @id @default(uuid())
  userId      String    @unique @map("user_id")
  status      KycStatus @default(PENDING)
  submittedAt DateTime  @default(now()) @map("submitted_at")
  reviewedAt  DateTime? @map("reviewed_at")

  documents KycDocument[]

  @@map("kyc_submissions")
}

model KycDocument {
  id           String        @id @default(uuid())
  submissionId String        @map("submission_id")
  documentType String        @map("document_type")
  fileUrl      String        @map("file_url")
  uploadedAt   DateTime      @default(now()) @map("uploaded_at")
  submission   KycSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)

  @@index([submissionId])
  @@map("kyc_documents")
}
`,
  'cms-service': `${PRISMA_HEADER}model Page {
  id        String   @id @default(uuid())
  slug      String   @unique
  title     String
  content   String
  published Boolean  @default(false)
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("pages")
}

model Banner {
  id        String  @id @default(uuid())
  title     String
  imageUrl  String  @map("image_url")
  linkUrl   String? @map("link_url")
  active    Boolean @default(true)
  sortOrder Int     @default(0) @map("sort_order")

  @@map("banners")
}
`,
  'support-service': `${PRISMA_HEADER}enum TicketStatus {
  OPEN
  IN_PROGRESS
  RESOLVED
  CLOSED
}

enum TicketPriority {
  LOW
  MEDIUM
  HIGH
}

model SupportTicket {
  id        String         @id @default(uuid())
  userId    String         @map("user_id")
  subject   String
  status    TicketStatus   @default(OPEN)
  priority  TicketPriority @default(MEDIUM)
  createdAt DateTime       @default(now()) @map("created_at")
  updatedAt DateTime       @updatedAt @map("updated_at")

  messages TicketMessage[]

  @@index([userId])
  @@map("support_tickets")
}

model TicketMessage {
  id        String        @id @default(uuid())
  ticketId  String        @map("ticket_id")
  senderId  String        @map("sender_id")
  body      String
  createdAt DateTime      @default(now()) @map("created_at")
  ticket    SupportTicket @relation(fields: [ticketId], references: [id], onDelete: Cascade)

  @@index([ticketId])
  @@map("ticket_messages")
}
`,
  'compliance-service': `${PRISMA_HEADER}enum LimitType {
  DEPOSIT
  LOSS
  SESSION_TIME
}

model ResponsibleGamblingLimit {
  id        String    @id @default(uuid())
  userId    String    @map("user_id")
  type      LimitType
  amount    Decimal?  @db.Decimal(18, 2)
  duration  Int?
  active    Boolean   @default(true)
  createdAt DateTime  @default(now()) @map("created_at")

  @@index([userId])
  @@map("responsible_gambling_limits")
}

model SelfExclusion {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  startsAt  DateTime @map("starts_at")
  endsAt    DateTime @map("ends_at")
  createdAt DateTime @default(now()) @map("created_at")

  @@index([userId])
  @@map("self_exclusions")
}
`,
  'live-service': `${PRISMA_HEADER}model LiveFeed {
  id        String   @id @default(uuid())
  eventId   String   @map("event_id")
  status    String   @default("active")
  startedAt DateTime @default(now()) @map("started_at")

  updates LiveUpdate[]

  @@index([eventId])
  @@map("live_feeds")
}

model LiveUpdate {
  id         String   @id @default(uuid())
  feedId     String   @map("feed_id")
  updateType String   @map("update_type")
  payload    Json
  createdAt  DateTime @default(now()) @map("created_at")
  feed       LiveFeed @relation(fields: [feedId], references: [id], onDelete: Cascade)

  @@index([feedId])
  @@map("live_updates")
}
`,
};

const services = [
  { name: 'auth-service', port: 3001, events: true, argon2: true, jwt: true },
  { name: 'wallet-service', port: 3002, events: true },
  { name: 'catalog-service', port: 3003, events: false },
  { name: 'odds-service', port: 3004, events: true },
  { name: 'sportsbook-service', port: 3005, events: true },
  { name: 'settlement-service', port: 3006, events: true },
  { name: 'casino-service', port: 3007, events: false },
  { name: 'promotions-service', port: 3008, events: false },
  { name: 'notification-service', port: 3009, events: true },
  { name: 'kyc-service', port: 3010, events: true },
  { name: 'cms-service', port: 3011, events: false },
  { name: 'support-service', port: 3012, events: true },
  { name: 'compliance-service', port: 3013, events: false },
  { name: 'live-service', port: 3014, events: true },
  { name: 'file-service', port: 3015, events: false, noPrisma: true },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

function tsconfig() {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'commonjs',
        lib: ['ES2022'],
        outDir: 'dist',
        rootDir: 'src',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
      },
      include: ['src/**/*'],
    },
    null,
    2,
  );
}

function dockerfile(service) {
  return `FROM node:20-alpine AS builder
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
}

function fileServiceDockerfile() {
  return `FROM node:20-alpine AS builder
WORKDIR /app
COPY packages/shared ./packages/shared
COPY packages/service-common ./packages/service-common
COPY services/file-service ./services/file-service
RUN cd packages/shared && npm install && npm run build
RUN cd packages/service-common && npm install && npm run build
WORKDIR /app/services/file-service
RUN npm install
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/services/file-service/dist ./dist
COPY --from=builder /app/services/file-service/node_modules ./node_modules
COPY --from=builder /app/services/file-service/package.json ./
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
`;
}

function packageJson(svc) {
  const deps = {
    express: '^4.21.2',
    '@prisma/client': '^6.3.0',
    uuid: '^11.0.5',
    '@wickets/service-common': 'file:../../packages/service-common',
    '@wickets/shared': 'file:../../packages/shared',
  };
  const devDeps = {
    prisma: '^6.3.0',
    '@types/express': '^5.0.0',
    '@types/node': '^22.10.7',
    '@types/uuid': '^10.0.0',
    typescript: '^5.7.3',
  };

  if (svc.events) deps.amqplib = '^0.10.5';
  if (svc.argon2) deps.argon2 = '^0.41.1';
  if (svc.jwt) deps.jsonwebtoken = '^9.0.2';

  const scripts = {
    build: 'tsc',
    start: 'node dist/index.js',
  };
  if (!svc.noPrisma) {
    scripts['prisma:generate'] = 'prisma generate';
    scripts['prisma:migrate'] = 'prisma migrate dev';
  }

  if (svc.jwt) devDeps['@types/jsonwebtoken'] = '^9.0.7';
  if (svc.events) devDeps['@types/amqplib'] = '^0.10.6';
  if (svc.argon2) devDeps['@types/argon2'] = '^0.15.4';

  return JSON.stringify(
    {
      name: `@wickets/${svc.name}`,
      version: '1.0.0',
      private: true,
      main: 'dist/index.js',
      scripts,
      dependencies: deps,
      devDependencies: devDeps,
    },
    null,
    2,
  );
}

function filePackageJson() {
  return JSON.stringify(
    {
      name: '@wickets/file-service',
      version: '1.0.0',
      private: true,
      main: 'dist/index.js',
      scripts: {
        build: 'tsc',
        start: 'node dist/index.js',
      },
      dependencies: {
        express: '^4.21.2',
        uuid: '^11.0.5',
        '@wickets/service-common': 'file:../../packages/service-common',
        '@wickets/shared': 'file:../../packages/shared',
      },
      devDependencies: {
        '@types/express': '^5.0.0',
        '@types/node': '^22.10.7',
        '@types/uuid': '^10.0.0',
        typescript: '^5.7.3',
      },
    },
    null,
    2,
  );
}

function serviceIndex(svc) {
  if (svc.noPrisma) {
    return `import { createServiceApp, startService } from '@wickets/service-common';

const port = Number(process.env.PORT) || ${svc.port};
const name = '${svc.name}';

const app = createServiceApp(name);

startService(app, port, name);
`;
  }

  const prismaImport = "import { PrismaClient } from '@prisma/client';\n";
  const prismaInit = '\nconst prisma = new PrismaClient();\n\nprocess.on(\'beforeExit\', () => prisma.$disconnect());\n';

  return `import { createServiceApp, startService } from '@wickets/service-common';
${prismaImport}
const port = Number(process.env.PORT) || ${svc.port};
const name = '${svc.name}';

const app = createServiceApp(name);
${prismaInit}
startService(app, port, name);
`;
}

const created = [];

for (const svc of services) {
  const dir = path.join(SERVICES_DIR, svc.name);
  const files = [
    [path.join(dir, 'package.json'), svc.noPrisma ? filePackageJson() : packageJson(svc)],
    [path.join(dir, 'tsconfig.json'), tsconfig()],
    [path.join(dir, 'src', 'index.ts'), serviceIndex(svc)],
    [
      path.join(dir, 'Dockerfile'),
      svc.noPrisma ? fileServiceDockerfile() : dockerfile(svc.name),
    ],
  ];

  if (!svc.noPrisma) {
    files.push([path.join(dir, 'prisma', 'schema.prisma'), schemas[svc.name]]);
  }

  for (const [filePath, content] of files) {
    writeFile(filePath, content.endsWith('\n') ? content : content + '\n');
    created.push(path.relative(ROOT, filePath));
  }
}

// api-gateway
const gatewayDir = path.join(SERVICES_DIR, 'api-gateway');
const gatewayFiles = [
  [
    path.join(gatewayDir, 'package.json'),
    JSON.stringify(
      {
        name: '@wickets/api-gateway',
        version: '1.0.0',
        private: true,
        main: 'dist/index.js',
        scripts: { build: 'tsc', start: 'node dist/index.js' },
        dependencies: {
          express: '^4.21.2',
          'http-proxy-middleware': '^3.0.3',
          jsonwebtoken: '^9.0.2',
          cors: '^2.8.5',
          helmet: '^8.0.0',
          morgan: '^1.10.0',
          '@wickets/shared': 'file:../../packages/shared',
        },
        devDependencies: {
          '@types/cors': '^2.8.17',
          '@types/express': '^5.0.0',
          '@types/jsonwebtoken': '^9.0.7',
          '@types/morgan': '^1.9.9',
          '@types/node': '^22.10.7',
          typescript: '^5.7.3',
        },
      },
      null,
      2,
    ),
  ],
  [path.join(gatewayDir, 'tsconfig.json'), tsconfig()],
  [
    path.join(gatewayDir, 'Dockerfile'),
    `FROM node:20-alpine AS builder
WORKDIR /app
COPY packages/shared ./packages/shared
COPY services/api-gateway ./services/api-gateway
RUN cd packages/shared && npm install && npm run build
WORKDIR /app/services/api-gateway
RUN npm install
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/services/api-gateway/dist ./dist
COPY --from=builder /app/services/api-gateway/node_modules ./node_modules
COPY --from=builder /app/services/api-gateway/package.json ./
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
`,
  ],
  [
    path.join(gatewayDir, 'src', 'index.ts'),
    `import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import {
  JwtPayload,
  USER_CONTEXT_HEADER,
  USER_NAME_HEADER,
  USER_ROLE_HEADER,
} from '@wickets/shared';

const port = Number(process.env.PORT) || 8080;

type AuthedRequest = Request & { user?: JwtPayload };

const routes: Array<{ path: string; env: string; publicPaths?: string[] }> = [
  { path: '/api/auth', env: 'AUTH_SERVICE_URL', publicPaths: ['/login', '/register', '/refresh'] },
  { path: '/api/wallet', env: 'WALLET_SERVICE_URL' },
  { path: '/api/catalog', env: 'CATALOG_SERVICE_URL', publicPaths: ['/sports', '/events'] },
  { path: '/api/odds', env: 'ODDS_SERVICE_URL', publicPaths: ['/markets'] },
  { path: '/api/sportsbook', env: 'SPORTSBOOK_SERVICE_URL' },
  { path: '/api/settlement', env: 'SETTLEMENT_SERVICE_URL' },
  { path: '/api/casino', env: 'CASINO_SERVICE_URL', publicPaths: ['/games'] },
  { path: '/api/promotions', env: 'PROMOTIONS_SERVICE_URL', publicPaths: ['/active'] },
  { path: '/api/notifications', env: 'NOTIFICATION_SERVICE_URL' },
  { path: '/api/kyc', env: 'KYC_SERVICE_URL' },
  { path: '/api/cms', env: 'CMS_SERVICE_URL', publicPaths: ['/pages', '/banners'] },
  { path: '/api/support', env: 'SUPPORT_SERVICE_URL' },
  { path: '/api/compliance', env: 'COMPLIANCE_SERVICE_URL' },
  { path: '/api/live', env: 'LIVE_SERVICE_URL', publicPaths: ['/feeds'] },
  { path: '/api/files', env: 'FILE_SERVICE_URL' },
];

function isPublicRoute(basePath: string, reqPath: string, publicPaths?: string[]): boolean {
  if (!publicPaths?.length) return false;
  const relative = reqPath.startsWith(basePath) ? reqPath.slice(basePath.length) : reqPath;
  return publicPaths.some((p) => relative === p || relative.startsWith(\`\${p}/\`));
}

function jwtMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing or invalid authorization header' });
  }
  const token = authHeader.slice(7);
  try {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error('JWT_ACCESS_SECRET not configured');
    req.user = jwt.verify(token, secret) as JwtPayload;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

const app = express();
app.use(helmet());
app.use(
  cors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
    credentials: true,
  }),
);
app.use(express.json({ limit: '2mb' }));
app.use(morgan('[api-gateway] :method :url :status'));

app.get('/health', (_req, res) =>
  res.json({ service: 'api-gateway', status: 'ok', ts: new Date().toISOString() }),
);

for (const route of routes) {
  const target = process.env[route.env];
  if (!target) {
    console.warn(\`Missing \${route.env}; skipping \${route.path}\`);
    continue;
  }

  const proxy = createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: (path) => path.replace(new RegExp(\`^\${route.path}\`), '') || '/',
    on: {
      proxyReq: (proxyReq, req) => {
        const authed = req as AuthedRequest;
        if (authed.user) {
          proxyReq.setHeader(USER_CONTEXT_HEADER, authed.user.sub);
          proxyReq.setHeader(USER_NAME_HEADER, authed.user.username);
          proxyReq.setHeader(USER_ROLE_HEADER, authed.user.role);
        }
        fixRequestBody(proxyReq, req);
      },
    },
  });

  app.use(route.path, (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (isPublicRoute(route.path, req.path, route.publicPaths)) {
      return proxy(req, res, next);
    }
    jwtMiddleware(req, res, (err) => {
      if (err) return next(err);
      proxy(req, res, next);
    });
  });
}

app.use((_req, res) => res.status(404).json({ message: 'Not found' }));

app.listen(port, () => console.log(\`api-gateway listening on \${port}\`));
`,
  ],
];

for (const [filePath, content] of gatewayFiles) {
  writeFile(filePath, content.endsWith('\n') ? content : content + '\n');
  created.push(path.relative(ROOT, filePath));
}

console.log(JSON.stringify(created, null, 2));
