import { createServiceApp, startService, asyncHandler, userContextMiddleware, adminOnly } from '@wickets/service-common';
import { PrismaClient } from '@prisma/client';

const app = createServiceApp('promotions-service');
const prisma = new PrismaClient();
const port = Number(process.env.PORT) || 3008;
const WALLET_URL = process.env.WALLET_SERVICE_URL ?? 'http://localhost:3002';
const SVC_KEY = process.env.SERVICE_API_KEY ?? '';

app.get('/active', asyncHandler(async (_req, res) => {
  res.json(await prisma.promotion.findMany({ where: { isActive: true } }));
}));

app.post('/redeem', userContextMiddleware, asyncHandler(async (req, res) => {
  const user = (req as typeof req & { user: { sub: string } }).user;
  const promo = await prisma.promotion.findUnique({ where: { code: req.body.code } });
  if (!promo || !promo.isActive) return void res.status(404).json({ message: 'Invalid code' });
  const existing = await prisma.userPromotion.findUnique({
    where: { userId_promotionId: { userId: user.sub, promotionId: promo.id } },
  });
  if (existing) return void res.status(409).json({ message: 'Already redeemed' });
  const up = await prisma.userPromotion.create({
    data: { userId: user.sub, promotionId: promo.id, bonusAmount: promo.bonusAmount },
  });
  await fetch(`${WALLET_URL}/internal/credit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-service-api-key': SVC_KEY },
    body: JSON.stringify({ userId: user.sub, amount: promo.bonusAmount, type: 'BONUS_CREDIT', referenceId: up.id, note: promo.name }),
  });
  res.status(201).json(up);
}));

app.post('/admin', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  res.status(201).json(await prisma.promotion.create({ data: req.body }));
}));

app.post('/internal/seed', asyncHandler(async (_req, res) => {
  await prisma.promotion.upsert({
    where: { code: 'WELCOME100' },
    create: { name: 'Welcome Bonus', type: 'WELCOME_BONUS', bonusAmount: 100, code: 'WELCOME100' },
    update: {},
  });
  res.json({ message: 'Promotions seeded' });
}));

process.on('beforeExit', () => prisma.$disconnect());
startService(app, port, 'promotions-service');
