import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  USER_CONTEXT_HEADER,
  USER_ROLE_HEADER,
  USER_NAME_HEADER,
  UserRole,
} from '../index';

@Injectable()
export class UserContextGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const userId = req.headers[USER_CONTEXT_HEADER];
    if (!userId) throw new UnauthorizedException('Missing user context');
    req.user = {
      sub: userId as string,
      username: (req.headers[USER_NAME_HEADER] as string) ?? '',
      role: (req.headers[USER_ROLE_HEADER] as UserRole) ?? UserRole.USER,
    };
    return true;
  }
}
