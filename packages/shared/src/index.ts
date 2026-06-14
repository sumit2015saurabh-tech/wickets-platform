export enum Events {
  USER_REGISTERED = 'user.registered',
  WITHDRAWAL_REQUESTED = 'wallet.withdrawal.requested',
  DEPOSIT_COMPLETED = 'wallet.deposit.completed',
  BET_PLACED = 'bet.placed',
  BET_SETTLED = 'bet.settled',
  KYC_SUBMITTED = 'kyc.submitted',
  SUPPORT_TICKET_CREATED = 'support.ticket.created',
}

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

export interface JwtPayload {
  sub: string;
  username: string;
  role: UserRole;
}

export interface ServiceContext {
  userId?: string;
  username?: string;
  role?: UserRole;
  requestId?: string;
}

export const SERVICE_API_KEY_HEADER = 'x-service-api-key';
export const USER_CONTEXT_HEADER = 'x-user-id';
export const USER_ROLE_HEADER = 'x-user-role';
export const USER_NAME_HEADER = 'x-user-name';

export * from './guards/service-key.guard';
export * from './guards/user-context.guard';
export * from './rabbitmq';
