import {
  createServiceApp,
  startService,
  asyncHandler,
  userContextMiddleware,
  adminOnly,
  serviceKeyMiddleware,
} from '@wickets/service-common';
import { PrismaClient, LedgerType, WithdrawalStatus } from '@prisma/client';
import { publishEvent, subscribeEvent, Events } from '@wickets/shared';

const port = Number(process.env.PORT) || 3002;
const name = 'wallet-service';
const app = createServiceApp(name);
const prisma = new PrismaClient();

type ReqUser = { sub: string; role: string };

async function ensureWallet(userId: string) {
  return prisma.wallet.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

app.get(
  '/balance',
  userContextMiddleware,
  asyncHandler(async (req, res) => {
    const user = (req as typeof req & { user: ReqUser }).user;
    const wallet = await ensureWallet(user.sub);
    res.json({
      balance: wallet.balance,
      reservedBalance: wallet.reservedBalance,
      availableBalance: wallet.balance - wallet.reservedBalance,
    });
  }),
);

app.get(
  '/transactions',
  userContextMiddleware,
  asyncHandler(async (req, res) => {
    const user = (req as typeof req & { user: ReqUser }).user;
    const page = Number(req.query.page ?? 1);
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const [items, total] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where: { userId: user.sub },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.ledgerEntry.count({ where: { userId: user.sub } }),
    ]);
    res.json({ items, meta: { total, page, limit } });
  }),
);

app.post(
  '/withdrawal-requests',
  userContextMiddleware,
  asyncHandler(async (req, res) => {
    const user = (req as typeof req & { user: ReqUser }).user;
    const { amount, note } = req.body;
    if (!amount || amount < 1) return void res.status(400).json({ message: 'Invalid amount' });

    const result = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId: user.sub } });
      if (!wallet) throw new Error('NO_WALLET');
      const available = wallet.balance - wallet.reservedBalance;
      if (amount > available) throw new Error('INSUFFICIENT');

      const pending = await tx.withdrawalRequest.count({
        where: { userId: user.sub, status: WithdrawalStatus.PENDING },
      });
      if (pending > 0) throw new Error('PENDING_EXISTS');

      const updated = await tx.wallet.update({
        where: { id: wallet.id, version: wallet.version },
        data: { reservedBalance: { increment: amount }, version: { increment: 1 } },
      });

      const withdrawal = await tx.withdrawalRequest.create({
        data: { userId: user.sub, amount, userNote: note },
      });

      await tx.ledgerEntry.create({
        data: {
          userId: user.sub,
          type: LedgerType.WITHDRAWAL_REQUEST,
          amount: -amount,
          balanceAfter: updated.balance - updated.reservedBalance,
          referenceId: withdrawal.id,
          note: note ?? 'Withdrawal requested',
        },
      });

      return withdrawal;
    }).catch((e) => {
      if (e.message === 'INSUFFICIENT') return 'INSUFFICIENT';
      if (e.message === 'PENDING_EXISTS') return 'PENDING_EXISTS';
      throw e;
    });

    if (result === 'INSUFFICIENT') return void res.status(400).json({ message: 'Insufficient balance' });
    if (result === 'PENDING_EXISTS') return void res.status(409).json({ message: 'Pending withdrawal exists' });

    await publishEvent(Events.WITHDRAWAL_REQUESTED, {
      withdrawalId: (result as { id: string }).id,
      userId: user.sub,
      amount,
    });

    res.status(201).json(result);
  }),
);

// ─── Admin routes ────────────────────────────────────────────────────────────

app.get(
  '/admin/users',
  userContextMiddleware,
  adminOnly,
  asyncHandler(async (req, res) => {
    const sortBy = (req.query.sortBy as string) ?? 'createdAt';
    const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';
    const page = Number(req.query.page ?? 1);
    const limit = Math.min(Number(req.query.limit ?? 20), 100);

    const orderBy =
      sortBy === 'amount' ? { balance: sortOrder as 'asc' | 'desc' }
      : { createdAt: sortOrder as 'asc' | 'desc' };

    const [wallets, total] = await Promise.all([
      prisma.wallet.findMany({
        orderBy: sortBy === 'amount' ? orderBy : undefined,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.wallet.count(),
    ]);

    res.json({
      items: wallets.map((w) => ({
        userId: w.userId,
        balance: w.balance,
        reservedBalance: w.reservedBalance,
        availableBalance: w.balance - w.reservedBalance,
        createdAt: w.createdAt,
      })),
      meta: { total, page, limit },
    });
  }),
);

app.post(
  '/admin/users/:userId/deposit',
  userContextMiddleware,
  adminOnly,
  asyncHandler(async (req, res) => {
    const admin = (req as typeof req & { user: ReqUser }).user;
    const { amount, note, idempotencyKey } = req.body;
    const userId = String(req.params.userId);

    if (idempotencyKey) {
      const existing = await prisma.ledgerEntry.findUnique({ where: { idempotencyKey } });
      if (existing) return void res.json(existing);
    }

    const entry = await prisma.$transaction(async (tx) => {
      const wallet = await ensureWallet(userId);
      const updated = await tx.wallet.update({
        where: { id: wallet.id, version: wallet.version },
        data: { balance: { increment: amount }, version: { increment: 1 } },
      });
      return tx.ledgerEntry.create({
        data: {
          userId,
          type: LedgerType.ADMIN_DEPOSIT,
          amount,
          balanceAfter: updated.balance - updated.reservedBalance,
          note: note ?? 'Admin deposit',
          adminId: admin.sub,
          idempotencyKey,
        },
      });
    });

    await publishEvent(Events.DEPOSIT_COMPLETED, { userId, amount, entryId: entry.id });
    res.status(201).json(entry);
  }),
);

app.get(
  '/admin/withdrawal-requests',
  userContextMiddleware,
  adminOnly,
  asyncHandler(async (req, res) => {
    const status = req.query.status as WithdrawalStatus | undefined;
    const items = await prisma.withdrawalRequest.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      include: { attachments: true },
    });
    res.json({ items });
  }),
);

app.patch(
  '/admin/withdrawal-requests/:id/approve',
  userContextMiddleware,
  adminOnly,
  asyncHandler(async (req, res) => {
    const admin = (req as typeof req & { user: ReqUser }).user;
    const { adminNote } = req.body;

    const entry = await prisma.$transaction(async (tx) => {
      const request = await tx.withdrawalRequest.findUnique({ where: { id: String(req.params.id) } });
      if (!request || request.status !== WithdrawalStatus.PENDING) throw new Error('INVALID');

      const wallet = await tx.wallet.findUnique({ where: { userId: request.userId } });
      if (!wallet) throw new Error('NO_WALLET');

      const updated = await tx.wallet.update({
        where: { id: wallet.id, version: wallet.version },
        data: {
          balance: { decrement: request.amount },
          reservedBalance: { decrement: request.amount },
          version: { increment: 1 },
        },
      });

      await tx.withdrawalRequest.update({
        where: { id: request.id },
        data: {
          status: WithdrawalStatus.APPROVED,
          adminNote,
          processedBy: admin.sub,
          processedAt: new Date(),
        },
      });

      return tx.ledgerEntry.create({
        data: {
          userId: request.userId,
          type: LedgerType.WITHDRAWAL_APPROVED,
          amount: -request.amount,
          balanceAfter: updated.balance - updated.reservedBalance,
          adminId: admin.sub,
          referenceId: request.id,
          note: adminNote,
        },
      });
    }).catch(() => null);

    if (!entry) return void res.status(409).json({ message: 'Cannot approve' });
    res.json(entry);
  }),
);

app.patch(
  '/admin/withdrawal-requests/:id/reject',
  userContextMiddleware,
  adminOnly,
  asyncHandler(async (req, res) => {
    const admin = (req as typeof req & { user: ReqUser }).user;
    const { adminNote } = req.body;
    if (!adminNote) return void res.status(400).json({ message: 'adminNote required' });

    const entry = await prisma.$transaction(async (tx) => {
      const request = await tx.withdrawalRequest.findUnique({ where: { id: String(req.params.id) } });
      if (!request || request.status !== WithdrawalStatus.PENDING) throw new Error('INVALID');

      const wallet = await tx.wallet.findUnique({ where: { userId: request.userId } });
      if (!wallet) throw new Error('NO_WALLET');

      const updated = await tx.wallet.update({
        where: { id: wallet.id, version: wallet.version },
        data: { reservedBalance: { decrement: request.amount }, version: { increment: 1 } },
      });

      await tx.withdrawalRequest.update({
        where: { id: request.id },
        data: {
          status: WithdrawalStatus.REJECTED,
          adminNote,
          processedBy: admin.sub,
          processedAt: new Date(),
        },
      });

      return tx.ledgerEntry.create({
        data: {
          userId: request.userId,
          type: LedgerType.WITHDRAWAL_REJECTED,
          amount: 0,
          balanceAfter: updated.balance - updated.reservedBalance,
          adminId: admin.sub,
          referenceId: request.id,
          note: adminNote,
        },
      });
    }).catch(() => null);

    if (!entry) return void res.status(409).json({ message: 'Cannot reject' });
    res.json(entry);
  }),
);

app.get(
  '/admin/notifications',
  userContextMiddleware,
  adminOnly,
  asyncHandler(async (req, res) => {
    const unreadOnly = req.query.unreadOnly === 'true';
    const items = await prisma.adminNotification.findMany({
      where: unreadOnly ? { isRead: false } : {},
      orderBy: { createdAt: 'desc' },
    });
    res.json({ items, unreadCount: items.filter((i) => !i.isRead).length });
  }),
);

app.patch(
  '/admin/notifications/:id/read',
  userContextMiddleware,
  adminOnly,
  asyncHandler(async (req, res) => {
    const item = await prisma.adminNotification.update({
      where: { id: String(req.params.id) },
      data: { isRead: true },
    });
    res.json(item);
  }),
);

// ─── Internal API (service-to-service) ─────────────────────────────────────

app.post(
  '/internal/debit',
  serviceKeyMiddleware,
  asyncHandler(async (req, res) => {
    const { userId, amount, type, referenceId, note } = req.body;
    const entry = await prisma.$transaction(async (tx) => {
      const wallet = await ensureWallet(userId);
      const available = wallet.balance - wallet.reservedBalance;
      if (amount > available) throw new Error('INSUFFICIENT');
      const updated = await tx.wallet.update({
        where: { id: wallet.id, version: wallet.version },
        data: { balance: { decrement: amount }, version: { increment: 1 } },
      });
      return tx.ledgerEntry.create({
        data: {
          userId,
          type: type as LedgerType,
          amount: -amount,
          balanceAfter: updated.balance - updated.reservedBalance,
          referenceId,
          note,
        },
      });
    }).catch(() => null);
    if (!entry) return void res.status(400).json({ message: 'Insufficient balance' });
    res.json(entry);
  }),
);

app.post(
  '/internal/credit',
  serviceKeyMiddleware,
  asyncHandler(async (req, res) => {
    const { userId, amount, type, referenceId, note } = req.body;
    const entry = await prisma.$transaction(async (tx) => {
      const wallet = await ensureWallet(userId);
      const updated = await tx.wallet.update({
        where: { id: wallet.id, version: wallet.version },
        data: { balance: { increment: amount }, version: { increment: 1 } },
      });
      return tx.ledgerEntry.create({
        data: {
          userId,
          type: type as LedgerType,
          amount,
          balanceAfter: updated.balance - updated.reservedBalance,
          referenceId,
          note,
        },
      });
    });
    res.json(entry);
  }),
);

app.post(
  '/internal/wallets/create',
  serviceKeyMiddleware,
  asyncHandler(async (req, res) => {
    const { userId } = req.body;
    const wallet = await ensureWallet(userId);
    res.json(wallet);
  }),
);

app.get(
  '/internal/balances/:userId',
  serviceKeyMiddleware,
  asyncHandler(async (req, res) => {
    const wallet = await prisma.wallet.findUnique({ where: { userId: String(req.params.userId) } });
    res.json(wallet ?? { balance: 0, reservedBalance: 0 });
  }),
);

// RabbitMQ: withdrawal notifications + wallet creation on register
subscribeEvent(Events.WITHDRAWAL_REQUESTED, 'wallet.withdrawal.notify', async (payload) => {
  const p = payload as { withdrawalId: string; userId: string; amount: number };
  await prisma.adminNotification.create({
    data: {
      type: 'WITHDRAWAL_REQUEST',
      title: 'New withdrawal request',
      message: `User ${p.userId} requested ${p.amount} points`,
      payload: p as object,
    },
  });
}).catch(console.error);

subscribeEvent(Events.USER_REGISTERED, 'wallet.user.registered', async (payload) => {
  const p = payload as { userId: string };
  await ensureWallet(p.userId);
}).catch(console.error);

process.on('beforeExit', () => prisma.$disconnect());
startService(app, port, name);
