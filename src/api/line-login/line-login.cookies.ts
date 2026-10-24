import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { parseCookie } from 'cookie';
import { LineLoginConfig } from './line-login.config.js';

/** HTTP เท่านั้น: อ่าน/ตั้ง/ล้าง cookie ไม่เรียก LINE หรือฐานข้อมูล */
@Injectable()
export class LineLoginCookies {
  constructor(
    @Inject(LineLoginConfig) private readonly config: LineLoginConfig,
  ) {}

  read(request: Request, kind: 'flow' | 'session'): string {
    const header = request.headers.cookie ?? '';
    const name = this.name(kind);
    if (
      header.split(';').filter((item) => item.trim().startsWith(`${name}=`))
        .length !== 1
    )
      return '';
    return parseCookie(header)[name] ?? '';
  }

  writeFlow(response: Response, token: string) {
    response.cookie(this.name('flow'), token, {
      ...this.options('flow'),
      maxAge: this.config.flowTtlMs,
    });
  }

  clearFlow(response: Response) {
    response.clearCookie(this.name('flow'), this.options('flow'));
  }

  writeSession(response: Response, token: string, expires: Date) {
    response.cookie(this.name('session'), token, {
      ...this.options('session'),
      expires,
    });
  }

  clearSession(response: Response) {
    response.clearCookie(this.name('session'), this.options('session'));
  }

  private name(kind: 'flow' | 'session') {
    return `${this.config.production ? '__Host-' : ''}aokkorn_${kind}`;
  }

  private options(kind: 'flow' | 'session'): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.production,
      path: '/',
      sameSite: kind === 'flow' ? 'lax' : this.config.sessionSameSite,
    };
  }
}
