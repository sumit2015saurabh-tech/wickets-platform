import {
  createServiceApp, startService, asyncHandler, userContextMiddleware, adminOnly, serviceKeyMiddleware,
} from '@wickets/service-common';
import { BetStatus } from '@prisma/client';

const app = createServiceApp('settlement-service');
const port = Number(process.env.PORT) || 3006;
const ODDS_URL = process.env.ODDS_SERVICE_URL ?? 'http://localhost:3004';
const SPORTSBOOK_URL = process.env.SPORTSBOOK_SERVICE_URL ?? 'http://localhost:3005';
const SVC_KEY = process.env.SERVICE_API_KEY ?? '';

async function svcFetch(url: string, opts: RequestInit = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-service-api-key': SVC_KEY, ...(opts.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Service error: ${res.status}`);
  return res.json();
}

app.post('/admin/markets/:marketId/settle', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { winningSelectionId } = req.body;
  await svcFetch(`${ODDS_URL}/internal/markets/${req.params.marketId}/settle`, {
    method: 'POST',
    body: JSON.stringify({ winningSelectionId }),
  });

  const { legs } = await svcFetch(`${SPORTSBOOK_URL}/internal/bets/by-market/${req.params.marketId}`) as {
    legs: Array<{ id: string; betId: string; selectionId: string; bet: { id: string; userId: string; stake: number; potentialWin: number; status: string } }>;
  };

  const betIds = [...new Set(legs.map((l) => l.betId))];
  for (const leg of legs) {
    const won = leg.selectionId === winningSelectionId;
    await svcFetch(`${SPORTSBOOK_URL}/internal/legs/${leg.id}/result`, {
      method: 'PATCH',
      body: JSON.stringify({ result: won ? BetStatus.WON : BetStatus.LOST }),
    });
  }

  for (const betId of betIds) {
    const bet = await svcFetch(`${SPORTSBOOK_URL}/internal/bets/${betId}`) as {
      id: string; status: string; stake: number; potentialWin: number; legs: Array<{ result: string }>;
    };
    if (bet.status !== BetStatus.ACCEPTED) continue;
    const allResolved = bet.legs.every((l) => l.result !== BetStatus.PENDING);
    if (!allResolved) continue;
    const anyLost = bet.legs.some((l) => l.result === BetStatus.LOST);
    if (anyLost) {
      await svcFetch(`${SPORTSBOOK_URL}/internal/settle-bet/${betId}`, {
        method: 'POST',
        body: JSON.stringify({ status: BetStatus.LOST, payout: 0 }),
      });
    } else {
      await svcFetch(`${SPORTSBOOK_URL}/internal/settle-bet/${betId}`, {
        method: 'POST',
        body: JSON.stringify({ status: BetStatus.WON, payout: bet.potentialWin }),
      });
    }
  }

  res.json({ marketId: req.params.marketId, settledBets: betIds.length });
}));

process.on('beforeExit', () => {});
startService(app, port, 'settlement-service');
