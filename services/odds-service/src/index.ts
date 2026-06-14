import {
  createServiceApp, startService, asyncHandler, userContextMiddleware, adminOnly, serviceKeyMiddleware,
} from '@wickets/service-common';
import { PrismaClient, MarketStatus } from '@prisma/client';

const app = createServiceApp('odds-service');
const prisma = new PrismaClient();
const port = Number(process.env.PORT) || 3004;

app.get('/fixtures/:fixtureId/markets', asyncHandler(async (req, res) => {
  const items = await prisma.market.findMany({
    where: { fixtureId: req.params.fixtureId },
    include: { selections: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
  });
  res.json({ items });
}));

app.get('/internal/selections/:id', serviceKeyMiddleware, asyncHandler(async (req, res) => {
  const sel = await prisma.marketSelection.findUnique({
    where: { id: req.params.id },
    include: { market: true },
  });
  if (!sel || !sel.isActive || sel.market.status !== MarketStatus.OPEN) {
    return void res.status(404).json({ message: 'Selection unavailable' });
  }
  res.json(sel);
}));

app.post('/admin/markets', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { fixtureId, name, marketType, isLive, selections } = req.body;
  const market = await prisma.market.create({
    data: {
      fixtureId, name, marketType, isLive: isLive ?? false,
      selections: { create: selections },
    },
    include: { selections: true },
  });
  res.status(201).json(market);
}));

app.patch('/admin/selections/:id/odds', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  res.json(await prisma.marketSelection.update({
    where: { id: req.params.id },
    data: { odds: req.body.odds },
  }));
}));

app.patch('/admin/markets/:id/suspend', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  res.json(await prisma.market.update({ where: { id: req.params.id }, data: { status: MarketStatus.SUSPENDED } }));
}));

app.patch('/admin/markets/:id/open', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  res.json(await prisma.market.update({ where: { id: req.params.id }, data: { status: MarketStatus.OPEN } }));
}));

app.post('/internal/markets/:id/settle', serviceKeyMiddleware, asyncHandler(async (req, res) => {
  const { winningSelectionId } = req.body;
  await prisma.$transaction(async (tx) => {
    const market = await tx.market.findUnique({ where: { id: req.params.id }, include: { selections: true } });
    if (!market) throw new Error('NOT_FOUND');
    for (const s of market.selections) {
      await tx.marketSelection.update({
        where: { id: s.id },
        data: { isWinner: s.id === winningSelectionId },
      });
    }
    await tx.market.update({ where: { id: market.id }, data: { status: MarketStatus.SETTLED } });
  });
  res.json({ settled: true, marketId: req.params.id, winningSelectionId });
}));

app.post('/internal/seed-market', serviceKeyMiddleware, asyncHandler(async (req, res) => {
  const { fixtureId, homeName, awayName } = req.body;
  const existing = await prisma.market.findFirst({ where: { fixtureId, marketType: 'MATCH_WINNER' } });
  if (existing) return void res.json(existing);

  const matchMarket = await prisma.market.create({
    data: {
      fixtureId,
      name: 'Match Odds',
      marketType: 'MATCH_WINNER',
      isLive: true,
      selections: {
        create: [
          { name: homeName, odds: 1.85, sortOrder: 1 },
          { name: awayName, odds: 2.05, sortOrder: 2 },
        ],
      },
    },
    include: { selections: true },
  });

  await prisma.market.create({
    data: {
      fixtureId,
      name: 'Bookmaker',
      marketType: 'BOOKMAKER',
      selections: {
        create: [
          { name: homeName, odds: 1.75, sortOrder: 1 },
          { name: awayName, odds: 2.1, sortOrder: 2 },
        ],
      },
    },
  });

  await prisma.market.create({
    data: {
      fixtureId,
      name: '10 Over Runs',
      marketType: 'FANCY',
      selections: {
        create: [
          { name: 'Yes 52', odds: 95, sortOrder: 1 },
          { name: 'No 52', odds: 95, sortOrder: 2 },
        ],
      },
    },
  });

  res.json(matchMarket);
}));

function drift(value: number, volatility = 0.01): number {
  const delta = (Math.random() - 0.5) * volatility;
  return Math.max(1.01, Math.round((Number(value) + delta) * 100) / 100);
}

app.get('/internal/odds-snapshot', serviceKeyMiddleware, asyncHandler(async (_req, res) => {
  const markets = await prisma.market.findMany({
    where: { status: MarketStatus.OPEN },
    include: { selections: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
  });

  const byFixture = new Map<string, typeof markets>();
  for (const m of markets) {
    const list = byFixture.get(m.fixtureId) ?? [];
    list.push(m);
    byFixture.set(m.fixtureId, list);
  }

  const fixtures = [...byFixture.entries()].map(([fixtureId, mkts]) => ({
    id: fixtureId,
    markets: mkts.map((m) => ({
      id: m.id,
      name: m.name,
      type: m.marketType,
      selections: m.selections.map((s) => ({
        id: s.id,
        name: s.name,
        back: Number(s.odds),
        lay: Math.round((Number(s.odds) + 0.02) * 100) / 100,
      })),
    })),
  }));

  res.json({ fixtures });
}));

app.post('/internal/tick-odds', serviceKeyMiddleware, asyncHandler(async (_req, res) => {
  const selections = await prisma.marketSelection.findMany({
    where: { isActive: true, market: { status: MarketStatus.OPEN } },
    include: { market: true },
  });
  let updated = 0;
  for (const s of selections) {
    const vol = s.market.marketType === 'FANCY' ? 0.4 : 0.012;
    await prisma.marketSelection.update({
      where: { id: s.id },
      data: { odds: drift(Number(s.odds), vol) },
    });
    updated += 1;
  }
  res.json({ updated, ts: Date.now() });
}));

// Real-time odds tick every 1s — WebSocket gateway broadcasts snapshot (20wickets uses 20s polling)
async function tickOdds() {
  const selections = await prisma.marketSelection.findMany({
    where: { isActive: true, market: { status: MarketStatus.OPEN } },
    include: { market: true },
  });
  for (const s of selections) {
    const vol = s.market.marketType === 'FANCY' ? 0.4 : 0.012;
    await prisma.marketSelection.update({
      where: { id: s.id },
      data: { odds: drift(Number(s.odds), vol) },
    });
  }
}
setInterval(() => { tickOdds().catch(() => {}); }, 1000);

process.on('beforeExit', () => prisma.$disconnect());
startService(app, port, 'odds-service');
