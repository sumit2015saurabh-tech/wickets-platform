import {
  createServiceApp, startService, asyncHandler, userContextMiddleware, adminOnly, serviceKeyMiddleware,
} from '@wickets/service-common';
import { PrismaClient, FixtureStatus } from '@prisma/client';

const app = createServiceApp('catalog-service');
const prisma = new PrismaClient();
const port = Number(process.env.PORT) || 3003;

app.get('/sports', asyncHandler(async (_req, res) => {
  res.json(await prisma.sport.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    include: { competitions: { where: { isActive: true } } },
  }));
}));

app.get('/fixtures', asyncHandler(async (req, res) => {
  const sportSlug = req.query.sportSlug as string | undefined;
  const status = req.query.status as FixtureStatus | undefined;
  const items = await prisma.fixture.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(sportSlug ? { competition: { sport: { slug: sportSlug } } } : {}),
    },
    orderBy: { startTime: 'asc' },
    include: { homeTeam: true, awayTeam: true, competition: { include: { sport: true } } },
  });
  res.json({ items });
}));

app.get('/fixtures/:id', asyncHandler(async (req, res) => {
  const fixture = await prisma.fixture.findUnique({
    where: { id: req.params.id },
    include: { homeTeam: true, awayTeam: true, competition: { include: { sport: true } } },
  });
  if (!fixture) return void res.status(404).json({ message: 'Not found' });
  res.json(fixture);
}));

app.get('/internal/fixtures/:id', serviceKeyMiddleware, asyncHandler(async (req, res) => {
  const fixture = await prisma.fixture.findUnique({
    where: { id: req.params.id },
    include: { homeTeam: true, awayTeam: true },
  });
  if (!fixture) return void res.status(404).json({ message: 'Not found' });
  res.json(fixture);
}));

app.post('/admin/sports', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  res.status(201).json(await prisma.sport.create({ data: req.body }));
}));

app.post('/admin/competitions', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  res.status(201).json(await prisma.competition.create({ data: req.body }));
}));

app.post('/admin/teams', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  res.status(201).json(await prisma.team.create({ data: req.body }));
}));

app.post('/admin/fixtures', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const data = { ...req.body, startTime: new Date(req.body.startTime) };
  res.status(201).json(await prisma.fixture.create({ data }));
}));

app.patch('/admin/fixtures/:id/status', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  res.json(await prisma.fixture.update({ where: { id: req.params.id }, data: req.body }));
}));

app.post('/internal/seed', serviceKeyMiddleware, asyncHandler(async (_req, res) => {
  const cricket = await prisma.sport.upsert({
    where: { slug: 'cricket' },
    create: { name: 'Cricket', slug: 'cricket', sortOrder: 1 },
    update: {},
  });
  const ipl = await prisma.competition.upsert({
    where: { sportId_slug: { sportId: cricket.id, slug: 'ipl' } },
    create: { sportId: cricket.id, name: 'IPL', slug: 'ipl', country: 'India' },
    update: {},
  });
  let mi = await prisma.team.findFirst({ where: { shortName: 'MI' } });
  if (!mi) mi = await prisma.team.create({ data: { name: 'Mumbai Indians', shortName: 'MI' } });
  let csk = await prisma.team.findFirst({ where: { shortName: 'CSK' } });
  if (!csk) csk = await prisma.team.create({ data: { name: 'Chennai Super Kings', shortName: 'CSK' } });
  const startTime = new Date(); startTime.setHours(startTime.getHours() + 2);
  const existing = await prisma.fixture.findFirst({ where: { competitionId: ipl.id, homeTeamId: mi.id } });
  if (!existing) {
    await prisma.fixture.create({
      data: { competitionId: ipl.id, homeTeamId: mi.id, awayTeamId: csk.id, startTime },
    });
  }
  res.json({ message: 'Catalog seeded' });
}));

process.on('beforeExit', () => prisma.$disconnect());
startService(app, port, 'catalog-service');
