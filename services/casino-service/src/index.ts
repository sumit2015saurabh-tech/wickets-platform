import {
  createServiceApp, startService, asyncHandler, userContextMiddleware, adminOnly,
} from '@wickets/service-common';
import { PrismaClient } from '@prisma/client';

const app = createServiceApp('casino-service');
const prisma = new PrismaClient();
const port = Number(process.env.PORT) || 3007;
const WALLET_URL = process.env.WALLET_SERVICE_URL ?? 'http://localhost:3002';
const SVC_KEY = process.env.SERVICE_API_KEY ?? '';

async function walletCall(path: string, body: object) {
  await fetch(`${WALLET_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-service-api-key': SVC_KEY },
    body: JSON.stringify(body),
  });
}

app.get('/games', asyncHandler(async (_req, res) => {
  res.json(await prisma.casinoGame.findMany({ where: { isActive: true } }));
}));

app.post('/sessions', userContextMiddleware, asyncHandler(async (req, res) => {
  const user = (req as typeof req & { user: { sub: string } }).user;
  const game = await prisma.casinoGame.findUnique({ where: { slug: req.body.gameSlug } });
  if (!game) return void res.status(404).json({ message: 'Game not found' });
  const session = await prisma.casinoSession.create({ data: { userId: user.sub, gameId: game.id }, include: { game: true } });
  res.status(201).json(session);
}));

app.post('/sessions/:id/bet', userContextMiddleware, asyncHandler(async (req, res) => {
  const user = (req as typeof req & { user: { sub: string } }).user;
  const { amount } = req.body;
  const session = await prisma.casinoSession.findFirst({ where: { id: req.params.id, userId: user.sub, status: 'ACTIVE' }, include: { game: true } });
  if (!session) return void res.status(404).json({ message: 'Session not found' });
  await walletCall('/internal/debit', { userId: user.sub, amount, type: 'CASINO_BET', referenceId: session.id, note: `Casino bet` });
  res.json(await prisma.casinoSession.update({ where: { id: session.id }, data: { totalBet: { increment: amount } } }));
}));

app.post('/sessions/:id/win', userContextMiddleware, asyncHandler(async (req, res) => {
  const user = (req as typeof req & { user: { sub: string } }).user;
  const { amount } = req.body;
  const session = await prisma.casinoSession.findFirst({ where: { id: req.params.id, userId: user.sub, status: 'ACTIVE' } });
  if (!session) return void res.status(404).json({ message: 'Not found' });
  await walletCall('/internal/credit', { userId: user.sub, amount, type: 'CASINO_WIN', referenceId: session.id, note: 'Casino win' });
  res.json(await prisma.casinoSession.update({ where: { id: session.id }, data: { totalWin: { increment: amount } } }));
}));

app.post('/admin/games', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  res.status(201).json(await prisma.casinoGame.create({ data: req.body }));
}));

app.post('/internal/seed', asyncHandler(async (_req, res) => {
  const catalog = require('../../../scripts/casino-catalog.js');
  let count = 0;
  for (const g of catalog) {
    await prisma.casinoGame.upsert({
      where: { slug: g.slug },
      create: { name: g.name, slug: g.slug, category: g.category, minBet: g.minBet, maxBet: g.maxBet },
      update: { name: g.name, category: g.category, isActive: true },
    });
    count += 1;
  }
  res.json({ message: 'Casino seeded', count });
}));

process.on('beforeExit', () => prisma.$disconnect());
startService(app, port, 'casino-service');
