import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { LineLoginCookies } from './line-login.cookies.js';
import { LineLoginService } from './line-login.service.js';

export type AuthenticatedRequest = Request & {
  auth: Awaited<ReturnType<LineLoginService['currentSession']>>;
};

/** ใช้ @UseGuards(SessionGuard) กับ API ที่ต้อง login; unsafe methods ตรวจ CSRF ด้วย */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(LineLoginService) private readonly login: LineLoginService,
    @Inject(LineLoginCookies) private readonly cookies: LineLoginCookies,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.cookies.read(request, 'session');
    request.auth = await this.login.currentSession(token);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      this.login.assertCsrf(
        token,
        request.headers.origin,
        request.headers['x-csrf-token'],
      );
    }
    return true;
  }
}
