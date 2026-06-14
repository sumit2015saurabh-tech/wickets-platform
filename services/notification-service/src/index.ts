import { createServiceApp, startService, asyncHandler, userContextMiddleware, adminOnly } from '@wickets/service-common';
import { PrismaClient } from '@prisma/client';
import { subscribeEvent, Events } from '@wickets/shared';

const app = createServiceApp('notification-service');
const prisma = new PrismaClient();
const port = Number(process.env.PORT) || 3009;

app.get('/admin', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const unreadOnly = req.query.unreadOnly === 'true';
  const items = await prisma.notification.findMany({
    where: unreadOnly ? { isRead: false } : {},
    orderBy: { createdAt: 'desc' },
  });
  res.json({ items });
}));

app.patch('/admin/:id/read', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  res.json(await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } }));
}));

async function listen() {
  const events = [
    Events.KYC_SUBMITTED,
    Events.SUPPORT_TICKET_CREATED,
    Events.BET_SETTLED,
  ];
  for (const ev of events) {
    await subscribeEvent(ev, `notification.${ev}`, async (payload) => {
      await prisma.notification.create({
        data: {
          type: ev,
          title: ev,
          message: JSON.stringify(payload),
          payload: payload as object,
        },
      });
    });
  }
}
listen().catch(console.error);

process.on('beforeExit', () => prisma.$disconnect());
startService(app, port, 'notification-service');
