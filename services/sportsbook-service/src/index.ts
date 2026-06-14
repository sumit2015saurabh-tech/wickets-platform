import {
  createServiceApp, startService, asyncHandler, userContextMiddleware, adminOnly, serviceKeyMiddleware,
} from '@wickets/service-common';
import { PrismaClient, BetStatus, BetType } from '@prisma/client';
import { publishEvent, Events } from '@wickets/shared';

const app = createServiceApp('sportsbook-service');
const prisma = new PrismaClient();
const port = Number(process.env.PORT) || 3005;
const ODDS_URL = process.env.ODDS_SERVICE_URL ?? 'http://localhost:3004';
const WALLET_URL = process.env.WALLET_SERVICE_URL ?? 'http://localhost:3002';
const COMPLIANCE_URL = process.env.COMPLIANCE_SERVICE_URL ?? 'http://localhost:3013';
const SVC_KEY = process.env.SERVICE_API_KEY ?? '';

async function svcFetch(url: string, opts: RequestInit = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-service-api-key': SVC_KEY,
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Service error: ${res.status}`);
  return res.json();
}

app.post('/bets', userContextMiddleware, asyncHandler(async (req, res) => {
  const user = (req as typeof req & { user: { sub: string } }).user;
  const { stake, legs } = req.body;
  if (!stake || !legs?.length) return void res.status(400).json({ message: 'Invalid bet' });

  await svcFetch(`${COMPLIANCE_URL}/internal/can-play/${user.sub}`);

  const resolved = await Promise.all(
    legs.map(async (l: { selectionId: string }) => {
      const sel = await svcFetch(`${ODDS_URL}/internal/selections/${l.selectionId}`);
      return sel as {
        id: string; odds: string; name: string;
        market: { id: string; name: string; fixtureId: string };
      };
    }),
  );

  const oddsNums = resolved.map((s) => Number(s.odds));
  const totalOdds = oddsNums.reduce((a, b) => a * b, 1);
  const potentialWin = Math.floor(stake * totalOdds);

  const bet = await prisma.bet.create({
    data: {
      userId: user.sub,
      type: resolved.length > 1 ? BetType.MULTI : BetType.SINGLE,
      stake,
      totalOdds,
      potentialWin,
      status: BetStatus.ACCEPTED,
      legs: {
        create: resolved.map((s) => ({
          marketId: s.market.id,
          selectionId: s.id,
          oddsAtPlacement: s.odds,
          selectionName: s.name,
          marketName: s.market.name,
          fixtureId: s.market.fixtureId,
          fixtureLabel: s.market.name,
          result: BetStatus.PENDING,
        })),
      },
    },
    include: { legs: true },
  });

  await svcFetch(`${WALLET_URL}/internal/debit`, {
    method: 'POST',
    body: JSON.stringify({
      userId: user.sub,
      amount: stake,
      type: 'BET_PLACED',
      referenceId: bet.id,
      note: `Bet stake ${stake}`,
    }),
  });

  await publishEvent(Events.BET_PLACED, { betId: bet.id, userId: user.sub, stake });
  res.status(201).json(bet);
}));

app.get('/bets', userContextMiddleware, asyncHandler(async (req, res) => {
  const user = (req as typeof req & { user: { sub: string } }).user;
  const items = await prisma.bet.findMany({
    where: { userId: user.sub },
    orderBy: { createdAt: 'desc' },
    include: { legs: true },
  });
  res.json({ items });
}));

app.get('/admin/bets', userContextMiddleware, adminOnly, asyncHandler(async (_req, res) => {
  const items = await prisma.bet.findMany({ orderBy: { createdAt: 'desc' }, include: { legs: true } });
  res.json({ items });
}));

app.get('/internal/bets/by-market/:marketId', serviceKeyMiddleware, asyncHandler(async (req, res) => {
  const legs = await prisma.betLeg.findMany({
    where: { marketId: req.params.marketId, result: BetStatus.PENDING },
    include: { bet: true },
  });
  res.json({ legs });
}));

app.post('/internal/settle-bet/:betId', serviceKeyMiddleware, asyncHandler(async (req, res) => {
  const { status, payout } = req.body as { status: BetStatus; payout: number };
  const bet = await prisma.bet.update({
    where: { id: req.params.betId },
    data: { status, payout, settledAt: new Date() },
  });
  if (payout > 0) {
    await svcFetch(`${WALLET_URL}/internal/credit`, {
      method: 'POST',
      body: JSON.stringify({
        userId: bet.userId,
        amount: payout,
        type: status === BetStatus.VOID ? 'BET_VOID' : 'BET_WON',
        referenceId: bet.id,
        note: `Bet ${status}`,
      }),
    });
  }
  await publishEvent(Events.BET_SETTLED, { betId: bet.id, userId: bet.userId, status, payout });
  res.json(bet);
}));

app.patch('/internal/legs/:legId/result', serviceKeyMiddleware, asyncHandler(async (req, res) => {
  const leg = await prisma.betLeg.update({
    where: { id: req.params.legId },
    data: { result: req.body.result },
    include: { bet: { include: { legs: true } } },
  });
  res.json(leg);
}));

app.get('/internal/bets/:betId', serviceKeyMiddleware, asyncHandler(async (req, res) => {
  const bet = await prisma.bet.findUnique({
    where: { id: req.params.betId },
    include: { legs: true },
  });
  if (!bet) return void res.status(404).json({ message: 'Not found' });
  res.json(bet);
}));

process.on('beforeExit', () => prisma.$disconnect());
startService(app, port, 'sportsbook-service');
