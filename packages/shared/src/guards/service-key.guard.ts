import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SERVICE_API_KEY_HEADER } from '../index';

@Injectable()
export class ServiceKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const key = req.headers[SERVICE_API_KEY_HEADER];
    const expected = process.env.SERVICE_API_KEY;
    if (!expected || key !== expected) {
      throw new UnauthorizedException('Invalid service credentials');
    }
    return true;
  }
}
