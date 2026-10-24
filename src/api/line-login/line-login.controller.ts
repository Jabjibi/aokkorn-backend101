import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  Inject,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { LineLoginService } from './line-login.service.js';
import { LineLoginCookies } from './line-login.cookies.js';
import { LineLoginConfig } from './line-login.config.js';
import { SessionGuard, type AuthenticatedRequest } from './session.guard.js';

/** รับ HTTP → เรียก service → ตั้ง cookie/redirect; logic login อยู่ใน service */
@Controller('auth')
export class LineLoginController {
  constructor(
    @Inject(LineLoginService) private readonly login: LineLoginService,
    @Inject(LineLoginCookies) private readonly cookies: LineLoginCookies,
    @Inject(LineLoginConfig) private readonly config: LineLoginConfig,
  ) {}

  /**
   * GET /api/v1/auth/line/start
   * รับ: เปิดผ่าน browser navigation
   * คืน: 302 ไปหน้า LINE Login
   */
  @Get('line/start')
  @UseGuards(ThrottlerGuard)
  start(@Res() response: Response) {
    const result = this.login.start();
    this.cookies.writeFlow(response, result.browserToken);
    response.redirect(302, result.authorizationUrl);
  }

  /**
   * GET /api/v1/auth/line/callback
   * รับ: code/state หรือ error จาก LINE และ flow cookie
   * คืน: session cookie และ 303 กลับ frontend
   */
  @Get('line/callback')
  @UseGuards(ThrottlerGuard)
  async callback(
    @Query('code') code: unknown,
    @Query('state') state: unknown,
    @Query('error') error: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    this.cookies.clearFlow(response);
    const result = await this.login.callback(
      code,
      state,
      this.cookies.read(request, 'flow'),
      error,
    );
    this.cookies.writeSession(response, result.sessionToken, result.expiresAt);
    response.redirect(303, this.config.successUrl);
  }

  /**
   * GET /api/v1/auth/me
   * รับ: session cookie
   * คืน: user, expiresAt และ csrfToken
   */
  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() request: AuthenticatedRequest) {
    return request.auth;
  }

  /**
   * POST /api/v1/auth/logout
   * รับ: session cookie, Origin, X-CSRF-Token
   * คืน: 204 และล้าง session cookie
   */
  @Post('logout')
  @UseGuards(SessionGuard)
  @HttpCode(204)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.login.logout(this.cookies.read(request, 'session'));
    this.cookies.clearSession(response);
  }
}
