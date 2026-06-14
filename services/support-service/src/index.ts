import { createServiceApp, startService, asyncHandler, userContextMiddleware, adminOnly } from '@wickets/service-common';
import { PrismaClient, TicketStatus } from '@prisma/client';
import { publishEvent, Events } from '@wickets/shared';

const app = createServiceApp('support-service');
const prisma = new PrismaClient();
const port = Number(process.env.PORT) || 3012;

app.post('/tickets', userContextMiddleware, asyncHandler(async (req, res) => {
  const user = (req as typeof req & { user: { sub: string } }).user;
  const ticket = await prisma.supportTicket.create({
    data: { userId: user.sub, subject: req.body.subject, message: req.body.message },
  });
  await publishEvent(Events.SUPPORT_TICKET_CREATED, { ticketId: ticket.id, userId: user.sub });
  res.status(201).json(ticket);
}));

app.get('/tickets', userContextMiddleware, asyncHandler(async (req, res) => {
  const user = (req as typeof req & { user: { sub: string } }).user;
  res.json(await prisma.supportTicket.findMany({ where: { userId: user.sub }, orderBy: { createdAt: 'desc' } }));
}));

app.get('/admin/tickets', userContextMiddleware, adminOnly, asyncHandler(async (_req, res) => {
  res.json(await prisma.supportTicket.findMany({ orderBy: { createdAt: 'desc' } }));
}));

app.patch('/admin/tickets/:id/reply', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  res.json(await prisma.supportTicket.update({
    where: { id: req.params.id },
    data: { adminReply: req.body.adminReply, status: TicketStatus.RESOLVED },
  }));
}));

process.on('beforeExit', () => prisma.$disconnect());
startService(app, port, 'support-service');
