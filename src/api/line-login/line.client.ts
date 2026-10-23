import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ApiError, ERRORS } from '../../common/api-error.filter.js';
import { LineLoginConfig } from './line-login.config.js';

export interface LineIdentity {
  subject: string;
  displayName: string;
}
export const LINE_FETCH = Symbol('LINE_FETCH');

/** เรียก LINE เท่านั้น: ไม่มี SQL และไม่คืน access/ID token ให้ frontend */
@Injectable()
export class LineClient {
  constructor(
    @Inject(LineLoginConfig) private readonly config: LineLoginConfig,
    @Inject(LINE_FETCH) private readonly fetcher: typeof fetch,
  ) {}

  authorizationUrl(state: string, nonce: string, verifier: string): string {
    const url = new URL('https://access.line.me/oauth2/v2.1/authorize');
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.channelId,
      redirect_uri: this.config.callbackUrl,
      scope: 'openid profile',
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    return url.href;
  }

  async verifyCode(
    code: string,
    verifier: string,
    nonce: string,
  ): Promise<LineIdentity> {
    const signal = AbortSignal.timeout(5000);
    const token = await this.post(
      'token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.callbackUrl,
        client_id: this.config.channelId,
        client_secret: this.config.channelSecret,
        code_verifier: verifier,
      }),
      signal,
    );
    if (
      typeof token.id_token !== 'string' ||
      !token.id_token ||
      token.id_token.length > 16384
    )
      this.malformed();
    const claims = await this.post(
      'verify',
      new URLSearchParams({
        id_token: token.id_token as string,
        client_id: this.config.channelId,
        nonce,
      }),
      signal,
    );
    const now = Math.floor(Date.now() / 1000);
    if (
      claims.iss !== 'https://access.line.me' ||
      claims.aud !== this.config.channelId ||
      claims.nonce !== nonce ||
      !Number.isSafeInteger(claims.exp) ||
      (claims.exp as number) <= now ||
      !Number.isSafeInteger(claims.iat) ||
      (claims.iat as number) > now + 60
    ) {
      throw new ApiError(
        ERRORS.LINE_CALLBACK_INVALID,
        'ตัวตนจาก LINE ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่',
      );
    }
    if (
      typeof claims.sub !== 'string' ||
      !claims.sub.trim() ||
      claims.sub.length > 255 ||
      typeof claims.name !== 'string' ||
      !claims.name.trim() ||
      claims.name.length > 100
    )
      this.malformed();
    return {
      subject: claims.sub as string,
      displayName: (claims.name as string).trim(),
    };
  }

  private malformed(): never {
    throw new ApiError(
      ERRORS.LINE_PROVIDER_ERROR,
      'ข้อมูลตอบกลับจาก LINE ไม่ถูกต้อง',
    );
  }

  private async post(
    action: 'token' | 'verify',
    body: URLSearchParams,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    try {
      const response = await this.fetcher(
        `https://api.line.me/oauth2/v2.1/${action}`,
        {
          method: 'POST',
          body,
          signal,
          redirect: 'error',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429 || response.status >= 500)
          throw new ApiError(
            ERRORS.LINE_PROVIDER_UNAVAILABLE,
            'LINE ไม่พร้อมใช้งานชั่วคราว',
          );
        if (response.status === 400 || response.status === 401)
          throw new ApiError(
            ERRORS.LINE_CALLBACK_INVALID,
            'คำขอ LINE ไม่ถูกต้อง กรุณาเริ่มใหม่',
          );
        this.malformed();
      }
      // จำกัดขนาดระหว่างอ่าน ไม่เชื่อ Content-Length จาก provider
      const reader = response.body?.getReader();
      if (!reader) this.malformed();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 32768) {
            await reader.cancel();
            this.malformed();
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data))
        this.malformed();
      return data as Record<string, unknown>;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof SyntaxError) this.malformed();
      throw new ApiError(
        ERRORS.LINE_PROVIDER_UNAVAILABLE,
        'เชื่อมต่อ LINE ไม่สำเร็จ กรุณาลองใหม่',
      );
    }
  }
}
