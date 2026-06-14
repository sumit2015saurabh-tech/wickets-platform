import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

export function createServiceApp(name: string): Express {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan(`[${name}] :method :url :status`));
  app.get('/health', (_req, res) =>
    res.json({ service: name, status: 'ok', ts: new Date().toISOString() }),
  );
  return app;
}

export function serviceKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-service-api-key'];
  if (key !== process.env.SERVICE_API_KEY) {
    return res.status(401).json({ message: 'Unauthorized service' });
  }
  next();
}

export function userContextMiddleware(req: Request, res: Response, next: NextFunction) {
  const userId = req.headers['x-user-id'];
  if (!userId || typeof userId !== 'string') {
    return res.status(401).json({ message: 'Missing user context' });
  }
  (req as Request & { user: object }).user = {
    sub: userId,
    username: req.headers['x-user-name'] ?? '',
    role: req.headers['x-user-role'] ?? 'USER',
  };
  next();
}

export function adminOnly(req: Request, res: Response, next: NextFunction) {
  const user = (req as Request & { user?: { role?: string } }).user;
  if (user?.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin only' });
  }
  next();
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
}

export function startService(app: Express, port: number, name: string) {
  app.use(errorHandler);
  app.listen(port, () => console.log(`${name} listening on ${port}`));
}
