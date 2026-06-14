import http from 'http';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { WebSocketServer, WebSocket } from 'ws';
import {
  JwtPayload,
  USER_CONTEXT_HEADER,
  USER_NAME_HEADER,
  USER_ROLE_HEADER,
} from '@wickets/shared';

const port = Number(process.env.PORT) || 8080;
const ODDS_URL = process.env.ODDS_SERVICE_URL ?? 'http://odds-service:3004';
const SVC_KEY = process.env.SERVICE_API_KEY ?? 'internal-service-key-change-me';
type AuthedRequest = Request & { user?: JwtPayload };

const routes: Array<{ mount: string; target: string; publicPaths?: RegExp[] }> = [
  {
    mount: '/api/auth',
    target: process.env.AUTH_SERVICE_URL ?? 'http://auth-service:3001',
    publicPaths: [/^\/register$/, /^\/login$/, /^\/refresh$/],
  },
  {
    mount: '/api/users',
    target: process.env.AUTH_SERVICE_URL ?? 'http://auth-service:3001',
  },
  {
    mount: '/api/wallet',
    target: process.env.WALLET_SERVICE_URL ?? 'http://wallet-service:3002',
  },
  {
    mount: '/api/catalog',
    target: process.env.CATALOG_SERVICE_URL ?? 'http://catalog-service:3003',
    publicPaths: [/^\/sports$/, /^\/fixtures(\/.*)?$/],
  },
  {
    mount: '/api/odds',
    target: process.env.ODDS_SERVICE_URL ?? 'http://odds-service:3004',
    publicPaths: [/^\/fixtures\/[^/]+\/markets$/],
  },
  {
    mount: '/api/sportsbook',
    target: process.env.SPORTSBOOK_SERVICE_URL ?? 'http://sportsbook-service:3005',
  },
  {
    mount: '/api/settlement',
    target: process.env.SETTLEMENT_SERVICE_URL ?? 'http://settlement-service:3006',
  },
  {
    mount: '/api/casino',
    target: process.env.CASINO_SERVICE_URL ?? 'http://casino-service:3007',
    publicPaths: [/^\/games$/],
  },
  {
    mount: '/api/promotions',
    target: process.env.PROMOTIONS_SERVICE_URL ?? 'http://promotions-service:3008',
    publicPaths: [/^\/active$/],
  },
  {
    mount: '/api/notifications',
    target: process.env.NOTIFICATION_SERVICE_URL ?? 'http://notification-service:3009',
  },
  {
    mount: '/api/kyc',
    target: process.env.KYC_SERVICE_URL ?? 'http://kyc-service:3010',
  },
  {
    mount: '/api/cms',
    target: process.env.CMS_SERVICE_URL ?? 'http://cms-service:3011',
    publicPaths: [/^\/pages(\/.*)?$/],
  },
  {
    mount: '/api/support',
    target: process.env.SUPPORT_SERVICE_URL ?? 'http://support-service:3012',
  },
  {
    mount: '/api/compliance',
    target: process.env.COMPLIANCE_SERVICE_URL ?? 'http://compliance-service:3013',
  },
  {
    mount: '/api/live',
    target: process.env.LIVE_SERVICE_URL ?? 'http://live-service:3014',
    publicPaths: [/^\/feeds\/[^/]+$/],
  },
  {
    mount: '/api/files',
    target: process.env.FILE_SERVICE_URL ?? 'http://file-service:3015',
  },
];

function jwtMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing authorization' });
  }
  try {
    const secret = process.env.JWT_ACCESS_SECRET!;
    req.user = jwt.verify(authHeader.slice(7), secret) as JwtPayload;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

const app = express();
app.use(helmet());
app.use(cors({
  origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,https://sumit2015saurabh-tech.github.io').split(','),
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('[gateway] :method :url :status'));

app.get('/health', (_req, res) =>
  res.json({ service: 'api-gateway', status: 'ok', architecture: 'microservices', ws: '/ws/odds' }),
);

app.use('/api/users', (req, _res, next) => {
  if (req.path === '/me') req.url = '/me';
  next();
});

for (const route of routes) {
  const proxy = createProxyMiddleware({
    target: route.target,
    changeOrigin: true,
    pathRewrite: (path) => path.replace(route.mount, '') || '/',
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

  app.use(route.mount, (req: AuthedRequest, res: Response, next: NextFunction) => {
    const subPath = req.path;
    const isPublic = route.publicPaths?.some((re) => re.test(subPath));
    if (isPublic) return proxy(req, res, next);
    jwtMiddleware(req, res, () => proxy(req, res, next));
  });
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/odds' });

async function broadcastOdds() {
  try {
    const res = await fetch(`${ODDS_URL}/internal/odds-snapshot`, {
      headers: { 'x-service-api-key': SVC_KEY },
    });
    if (!res.ok) return;
    const payload = (await res.json()) as Record<string, unknown>;
    const msg = JSON.stringify({ ts: Date.now(), ...payload });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  } catch {
    /* odds-service may be starting */
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '', 'http://localhost');
  const eventId = url.searchParams.get('event');
  ws.send(JSON.stringify({ type: 'connected', eventId, intervalMs: 1000 }));
  void broadcastOdds();
});

setInterval(broadcastOdds, 1000);

server.listen(port, () => console.log(`API Gateway on :${port} (WebSocket /ws/odds)`));
