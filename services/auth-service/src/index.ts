import { createHash, randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import {
  createServiceApp,
  startService,
  asyncHandler,
  userContextMiddleware,
  adminOnly,
  serviceKeyMiddleware,
} from '@wickets/service-common';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import { publishEvent, Events } from '@wickets/shared';

const port = Number(process.env.PORT) || 3001;
const name = 'auth-service';
const app = createServiceApp(name);
const prisma = new PrismaClient();

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;
const MAX_FAILS = 5;
const LOCK_MINUTES = 30;

function signAccess(user: { id: string; username: string; role: UserRole }) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    ACCESS_SECRET,
    { expiresIn: '15m' },
  );
}

async function issueTokens(user: { id: string; username: string; role: UserRole }) {
  const accessToken = signAccess(user);
  const refreshToken = randomBytes(48).toString('hex');
  const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });
  return { accessToken, refreshToken };
}

app.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { username, name, email, password, phone, state, district } = req.body;
    if (!username || !name || !email || !password || !state || !district) {
      return void res.status(400).json({ message: 'Missing required fields' });
    }
    const exists = await prisma.user.findFirst({
      where: { OR: [{ username }, { email: email.toLowerCase() }] },
    });
    if (exists) return void res.status(409).json({ message: 'Username or email exists' });

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        username,
        name,
        email: email.toLowerCase(),
        phone,
        state,
        district,
        passwordHash,
        role: UserRole.USER,
      },
      select: { id: true, username: true, name: true, email: true, role: true, state: true, district: true },
    });

    await publishEvent(Events.USER_REGISTERED, { userId: user.id, email: user.email });
    res.status(201).json(user);
  }),
);

app.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return void res.status(401).json({ message: 'Invalid credentials' });
    if (user.status === UserStatus.SUSPENDED) {
      return void res.status(401).json({ message: 'Account suspended' });
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return void res.status(401).json({ message: 'Account locked' });
    }
    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      const count = user.failedLoginCount + 1;
      const data: { failedLoginCount: number; lockedUntil?: Date } = { failedLoginCount: count };
      if (count >= MAX_FAILS) {
        const lockedUntil = new Date();
        lockedUntil.setMinutes(lockedUntil.getMinutes() + LOCK_MINUTES);
        data.lockedUntil = lockedUntil;
      }
      await prisma.user.update({ where: { id: user.id }, data });
      return void res.status(401).json({ message: 'Invalid credentials' });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const tokens = await issueTokens(user);
    res.json({
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
        state: user.state,
        district: user.district,
      },
      ...tokens,
    });
  }),
);

app.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return void res.status(400).json({ message: 'refreshToken required' });
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      return void res.status(401).json({ message: 'Invalid refresh token' });
    }
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    const tokens = await issueTokens(stored.user);
    res.json(tokens);
  }),
);

app.get(
  '/me',
  userContextMiddleware,
  asyncHandler(async (req, res) => {
    const user = (req as typeof req & { user: { sub: string } }).user;
    const profile = await prisma.user.findUnique({
      where: { id: user.sub },
      select: {
        id: true, username: true, name: true, email: true, phone: true,
        role: true, state: true, district: true, status: true, createdAt: true,
      },
    });
    if (!profile) return void res.status(404).json({ message: 'Not found' });
    res.json(profile);
  }),
);

// Internal: list users for admin (wallet service merges balances at gateway or client)
app.get(
  '/internal/users',
  serviceKeyMiddleware,
  asyncHandler(async (req, res) => {
    const sortBy = (req.query.sortBy as string) ?? 'createdAt';
    const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';
    const search = req.query.search as string | undefined;
    const state = req.query.state as string | undefined;
    const district = req.query.district as string | undefined;
    const page = Number(req.query.page ?? 1);
    const limit = Math.min(Number(req.query.limit ?? 20), 100);

    const where = {
      role: UserRole.USER,
      ...(state ? { state: { equals: state, mode: 'insensitive' as const } } : {}),
      ...(district ? { district: { equals: district, mode: 'insensitive' as const } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { username: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const orderBy =
      sortBy === 'name' ? { name: sortOrder as 'asc' | 'desc' }
      : sortBy === 'username' ? { username: sortOrder as 'asc' | 'desc' }
      : sortBy === 'state' ? { state: sortOrder as 'asc' | 'desc' }
      : sortBy === 'district' ? { district: sortOrder as 'asc' | 'desc' }
      : { createdAt: sortOrder as 'asc' | 'desc' };

    const [items, total] = await Promise.all([
      prisma.user.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
      prisma.user.count({ where }),
    ]);

    res.json({ items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } });
  }),
);

app.get(
  '/internal/users/:id',
  serviceKeyMiddleware,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
    if (!user) return void res.status(404).json({ message: 'Not found' });
    const { passwordHash, ...safe } = user;
    res.json(safe);
  }),
);

app.post(
  '/internal/seed-admin',
  serviceKeyMiddleware,
  asyncHandler(async (req, res) => {
    const username = process.env.SEED_ADMIN_USERNAME ?? 'admin';
    const exists = await prisma.user.findUnique({ where: { username } });
    if (exists) return void res.json({ message: 'Admin exists' });
    const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMeAdmin123!';
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await prisma.user.create({
      data: {
        username,
        email: process.env.SEED_ADMIN_EMAIL ?? 'admin@wickets.local',
        name: 'Platform Admin',
        state: 'Delhi',
        district: 'Central',
        passwordHash,
        role: UserRole.ADMIN,
      },
    });
    res.json({ message: 'Admin seeded' });
  }),
);

process.on('beforeExit', () => prisma.$disconnect());
startService(app, port, name);
