import { createServiceApp, startService, asyncHandler, userContextMiddleware, adminOnly, serviceKeyMiddleware } from '@wickets/service-common';
import { PrismaClient } from '@prisma/client';

const app = createServiceApp('compliance-service');
const prisma = new PrismaClient();
const port = Number(process.env.PORT) || 3013;

async function getLimit(userId: string) {
  return prisma.gamingLimit.upsert({ where: { userId }, create: { userId }, update: {} });
}

app.get('/internal/can-play/:userId', serviceKeyMiddleware, asyncHandler(async (req, res) => {
  const limit = await getLimit(req.params.userId);
  if (limit.selfExcludedUntil && limit.selfExcludedUntil > new Date()) {
    return void res.status(403).json({ message: 'Self excluded' });
  }
  res.json({ ok: true });
}));

app.post('/self-exclude', userContextMiddleware, asyncHandler(async (req, res) => {
  const user = (req as typeof req & { user: { sub: string } }).user;
  const until = new Date();
  until.setDate(until.getDate() + Number(req.body.days ?? 30));
  res.json(await prisma.gamingLimit.upsert({
    where: { userId: user.sub },
    create: { userId: user.sub, selfExcludedUntil: until },
    update: { selfExcludedUntil: until },
  }));
}));

app.get('/limits', userContextMiddleware, asyncHandler(async (req, res) => {
  const user = (req as typeof req & { user: { sub: string } }).user;
  res.json(await getLimit(user.sub));
}));

app.patch('/admin/users/:userId/limits', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  res.json(await prisma.gamingLimit.upsert({
    where: { userId: req.params.userId },
    create: { userId: req.params.userId, ...req.body },
    update: req.body,
  }));
}));

process.on('beforeExit', () => prisma.$disconnect());
startService(app, port, 'compliance-service');
