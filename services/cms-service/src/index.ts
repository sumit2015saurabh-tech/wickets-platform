import { createServiceApp, startService, asyncHandler, userContextMiddleware, adminOnly } from '@wickets/service-common';
import { PrismaClient } from '@prisma/client';

const app = createServiceApp('cms-service');
const prisma = new PrismaClient();
const port = Number(process.env.PORT) || 3011;

app.get('/pages', asyncHandler(async (req, res) => {
  const type = req.query.type as string | undefined;
  res.json(await prisma.cmsContent.findMany({ where: { isActive: true, ...(type ? { type } : {}) }, orderBy: { sortOrder: 'asc' } }));
}));

app.get('/pages/:slug', asyncHandler(async (req, res) => {
  const page = await prisma.cmsContent.findUnique({ where: { slug: req.params.slug } });
  if (!page?.isActive) return void res.status(404).json({ message: 'Not found' });
  res.json(page);
}));

app.post('/admin', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  res.status(201).json(await prisma.cmsContent.create({ data: req.body }));
}));

app.post('/internal/seed', asyncHandler(async (_req, res) => {
  await prisma.cmsContent.upsert({
    where: { slug: 'welcome-banner' },
    create: { slug: 'welcome-banner', title: 'Welcome to Wickets', body: 'Bet on cricket!', type: 'banner' },
    update: {},
  });
  res.json({ message: 'CMS seeded' });
}));

process.on('beforeExit', () => prisma.$disconnect());
startService(app, port, 'cms-service');
