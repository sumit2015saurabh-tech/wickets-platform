import { createServiceApp, startService, asyncHandler, userContextMiddleware, adminOnly } from '@wickets/service-common';
import { PrismaClient, KycStatus } from '@prisma/client';
import { publishEvent, Events } from '@wickets/shared';

const app = createServiceApp('kyc-service');
const prisma = new PrismaClient();
const port = Number(process.env.PORT) || 3010;

app.post('/submit', userContextMiddleware, asyncHandler(async (req, res) => {
  const user = (req as typeof req & { user: { sub: string } }).user;
  const sub = await prisma.kycSubmission.create({
    data: { userId: user.sub, documentType: req.body.documentType, documentRef: req.body.documentRef },
  });
  await publishEvent(Events.KYC_SUBMITTED, { submissionId: sub.id, userId: user.sub });
  res.status(201).json(sub);
}));

app.get('/status', userContextMiddleware, asyncHandler(async (req, res) => {
  const user = (req as typeof req & { user: { sub: string } }).user;
  res.json(await prisma.kycSubmission.findMany({ where: { userId: user.sub }, orderBy: { createdAt: 'desc' } }));
}));

app.get('/admin/pending', userContextMiddleware, adminOnly, asyncHandler(async (_req, res) => {
  res.json(await prisma.kycSubmission.findMany({ where: { status: KycStatus.PENDING } }));
}));

app.patch('/admin/:id/approve', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const admin = (req as typeof req & { user: { sub: string } }).user;
  res.json(await prisma.kycSubmission.update({
    where: { id: req.params.id },
    data: { status: KycStatus.APPROVED, reviewedBy: admin.sub, reviewedAt: new Date(), adminNote: req.body.adminNote },
  }));
}));

app.patch('/admin/:id/reject', userContextMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const admin = (req as typeof req & { user: { sub: string } }).user;
  res.json(await prisma.kycSubmission.update({
    where: { id: req.params.id },
    data: { status: KycStatus.REJECTED, reviewedBy: admin.sub, reviewedAt: new Date(), adminNote: req.body.adminNote },
  }));
}));

process.on('beforeExit', () => prisma.$disconnect());
startService(app, port, 'kyc-service');
