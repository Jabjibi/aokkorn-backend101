import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** อ่าน .env และตรวจตอนเริ่มแอป; services ใช้ class นี้แทนการอ่าน process.env เอง */
@Injectable()
export class LineLoginConfig {
  readonly production: boolean;
  readonly enabled: boolean;
  readonly port: number;
  readonly channelId: string;
  readonly channelSecret: string;
  readonly callbackUrl: string;
  readonly successUrl: string;
  readonly failureUrl?: string;
  readonly origins: string[];
  readonly databaseUrl: string;
  readonly databaseCaPath: string;
  readonly sessionTtlMs: number;
  readonly sessionSameSite: 'lax' | 'strict' | 'none';
  readonly flowTtlMs = 10 * 60 * 1000;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const text = (key: string, fallback = '') =>
      String(config.get(key) ?? fallback).trim();
    const fail = (key: string): never => {
      throw new Error(`ตั้งค่า ${key} ไม่ถูกต้อง`);
    };
    const env = text('NODE_ENV', 'development');
    if (!['development', 'test', 'production'].includes(env)) fail('NODE_ENV');
    this.production = env === 'production';
    const enabled = text('LINE_LOGIN_ENABLED', 'false');
    if (!['true', 'false'].includes(enabled)) fail('LINE_LOGIN_ENABLED');
    this.enabled = enabled === 'true';
    if (this.production && !this.enabled) fail('LINE_LOGIN_ENABLED');
    const number = (key: string, fallback: string, max: number) => {
      const value = text(key, fallback);
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max)
        fail(key);
      return Number(value);
    };
    const url = (key: string, value: string) => {
      try {
        const parsed = new URL(value);
        if (
          !['http:', 'https:'].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password ||
          parsed.hash ||
          (this.production && parsed.protocol !== 'https:')
        )
          fail(key);
        return parsed;
      } catch {
        return fail(key);
      }
    };
    this.port = number('PORT', '5016', 65535);
    const callback = url(
      'LINE_CALLBACK_URL',
      text(
        'LINE_CALLBACK_URL',
        'http://localhost:5016/api/v1/auth/line/callback',
      ),
    );
    if (callback.pathname !== '/api/v1/auth/line/callback' || callback.search)
      fail('LINE_CALLBACK_URL');
    this.callbackUrl = callback.href;
    this.origins = text(
      'ALLOWED_ORIGINS',
      'http://localhost:3000,http://localhost:5016',
    )
      .split(',')
      .map((value) => {
        const parsed = url('ALLOWED_ORIGINS', value.trim());
        if (parsed.origin !== value.trim()) fail('ALLOWED_ORIGINS');
        return parsed.origin;
      });
    const success = url(
      'LOGIN_SUCCESS_URL',
      text('LOGIN_SUCCESS_URL', 'http://localhost:5016/api/v1/auth/me'),
    );
    if (!this.origins.includes(success.origin)) fail('LOGIN_SUCCESS_URL');
    this.successUrl = success.href;
    // ตั้งเมื่อเชื่อม UI; ไม่ตั้งค่านี้ยังตอบ JSON ตาม API contract เดิม
    const failureValue = text('LOGIN_FAILURE_URL');
    if (failureValue) {
      const failure = url('LOGIN_FAILURE_URL', failureValue);
      if (!this.origins.includes(failure.origin)) fail('LOGIN_FAILURE_URL');
      this.failureUrl = failure.href;
    }
    this.channelId = text('LINE_CHANNEL_ID');
    this.channelSecret = text('LINE_CHANNEL_SECRET');
    this.databaseUrl = text('DATABASE_URL');
    this.databaseCaPath = text('DATABASE_CA_CERT_PATH');
    if (this.databaseUrl) {
      try {
        const database = new URL(this.databaseUrl);
        if (
          !['postgres:', 'postgresql:'].includes(database.protocol) ||
          !database.hostname ||
          database.pathname.length < 2
        )
          fail('DATABASE_URL');
      } catch {
        fail('DATABASE_URL');
      }
    }
    if (this.enabled) {
      if (!/^\d+$/.test(this.channelId)) fail('LINE_CHANNEL_ID');
      if (!this.channelSecret) fail('LINE_CHANNEL_SECRET');
      if (!this.databaseUrl) fail('DATABASE_URL');
    }
    this.sessionTtlMs = number('SESSION_TTL_HOURS', '168', 720) * 3_600_000;
    const sameSite = text('SESSION_COOKIE_SAME_SITE', 'lax');
    if (
      !['lax', 'strict', 'none'].includes(sameSite) ||
      (sameSite === 'none' && !this.production)
    )
      fail('SESSION_COOKIE_SAME_SITE');
    this.sessionSameSite = sameSite as 'lax' | 'strict' | 'none';
  }
}
