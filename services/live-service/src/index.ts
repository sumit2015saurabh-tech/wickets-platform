import { createServiceApp, startService, asyncHandler, userContextMiddleware, adminOnly, serviceKeyMiddleware } from '@wickets/service-common';
import { PrismaClient } from '@prisma/client';

const app = createServiceApp('live-service');
const prisma = new PrismaClient();
const port = Number(process.env.PORT) || 3014;
const ODDS_URL = process.env.ODDS_SERVICE_URL ?? 'http://localhost:3004';
const CATALOG_URL = process.env.CATALOG_SERVICE_URL ?? 'http://localhost:3003';
const SVC_KEY = process.env.SERVICE_API_KEY ?? '';

app.get('/feeds/:fixtureId', asyncHandler(async (req, res) => {
  res.json(await prisma.liveEvent.findMany({
    where: { fixtureId: req.params.fixtureId },
    orderBy: { createdAt: 'desc' },
  }));
}));

app.post('/admin/fixtures/:fixtureId/events', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const event = await prisma.liveEvent.create({
    data: { fixtureId: req.params.fixtureId, eventType: req.body.eventType, description: req.body.description, payload: req.body.payload },
  });
  res.status(201).json(event);
}));

app.post('/admin/fixtures/:fixtureId/score', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  await fetch(`${CATALOG_URL}/admin/fixtures/${req.params.fixtureId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': (req.headers['x-user-id'] as string) ?? '',
      'x-user-role': 'ADMIN',
      'x-user-name': 'admin',
    },
    body: JSON.stringify({ status: 'LIVE', homeScore: req.body.homeScore, awayScore: req.body.awayScore }),
  });
  res.json({ updated: true });
}));

app.post('/admin/fixtures/:fixtureId/suspend-markets', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const markets = await fetch(`${ODDS_URL}/fixtures/${req.params.fixtureId}/markets`).then((r) => r.json()) as { items: Array<{ id: string }> };
  for (const m of markets.items ?? []) {
    await fetch(`${ODDS_URL}/admin/markets/${m.id}/suspend`, {
      method: 'PATCH',
      headers: { 'x-user-id': 'admin', 'x-user-role': 'ADMIN', 'x-user-name': 'admin' },
    });
  }
  res.json({ suspended: (markets.items ?? []).length });
}));

process.on('beforeExit', () => prisma.$disconnect());
startService(app, port, 'live-service');
