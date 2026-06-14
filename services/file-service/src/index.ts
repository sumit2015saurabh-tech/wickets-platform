import { createServiceApp, startService, asyncHandler, userContextMiddleware, adminOnly, serviceKeyMiddleware } from '@wickets/service-common';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const port = Number(process.env.PORT) || 3015;
const app = createServiceApp('file-service');
const uploadDir = process.env.UPLOAD_DIR ?? './uploads';
if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${randomUUID()}-${file.originalname}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    cb(null, allowed.includes(file.mimetype));
  },
});

app.post('/upload', userContextMiddleware, adminOnly, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return void res.status(400).json({ message: 'No file' });
  res.status(201).json({
    fileId: req.file.filename,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
  });
}));

app.get('/:fileId', userContextMiddleware, asyncHandler(async (req, res) => {
  res.sendFile(join(uploadDir, req.params.fileId));
}));

process.on('beforeExit', () => {});
startService(app, port, 'file-service');
