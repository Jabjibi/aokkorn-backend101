import { Inject, Injectable } from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { ApiError, ERRORS } from '../../common/api-error.filter.js';
import { LineClient } from './line.client.js';
import { LineLoginConfig } from './line-login.config.js';
import { LineLoginRepository } from './line-login.repository.js';

interface LoginFlow {
  nonce: string;
  verifier: string;
  browserHash: string;
  expiresAt: number;
}

const randomToken = () => randomBytes(32).toString('hex');

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

const validToken = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length === 64 &&
  /^[a-f0-9]{64}$/.test(value);

const equalTokens = (left: string, right: string) =>
  validToken(left) &&
  validToken(right) &&
  timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));

/** เริ่มอ่าน logic ที่นี่: start → callback → LINE client → repository → session */
@Injectable()
export class LineLoginService {
  // OAuth ชั่วคราวรองรับหนึ่ง API instance; app sessions เก็บถาวรใน PostgreSQL
  private readonly flows = new Map<string, LoginFlow>();

  constructor(
    @Inject(LineLoginConfig) private readonly config: LineLoginConfig,
    @Inject(LineClient) private readonly line: LineClient,
    @Inject(LineLoginRepository)
    private readonly repository: LineLoginRepository,
  ) {}

  start() {
    this.requireEnabled();
    for (const [key, flow] of this.flows)
      if (flow.expiresAt <= Date.now()) this.flows.delete(key);
    if (this.flows.size >= 1000)
      throw new ApiError(
        ERRORS.LINE_PROVIDER_UNAVAILABLE,
        'ระบบเข้าสู่ระบบไม่พร้อมชั่วคราว',
      );
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken();
    const browserToken = randomToken();
    this.flows.set(hash(state), {
      nonce,
      verifier,
      browserHash: hash(browserToken),
      expiresAt: Date.now() + this.config.flowTtlMs,
    });
    return {
      browserToken,
      authorizationUrl: this.line.authorizationUrl(state, nonce, verifier),
    };
  }

  async callback(
    code: unknown,
    state: unknown,
    browserToken: string,
    error?: unknown,
  ) {
    this.requireEnabled();
    if (!validToken(state) || !validToken(browserToken)) this.invalidCallback();
    const key = hash(state);
    const flow = this.flows.get(key);
    if (!flow || flow.expiresAt <= Date.now()) {
      this.flows.delete(key);
      this.invalidCallback();
    }
    if (!equalTokens(flow.browserHash, hash(browserToken)))
      this.invalidCallback();
    // consume ก่อนเรียก LINE; callback ซ้ำ/ยกเลิกก็ไม่ใช้ state เดิมอีก
    this.flows.delete(key);
    if (
      error !== undefined ||
      typeof code !== 'string' ||
      !code.trim() ||
      code.length > 2048
    )
      this.invalidCallback();
    const identity = await this.line.verifyCode(
      code,
      flow.verifier,
      flow.nonce,
    );
    const sessionToken = randomToken();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlMs);
    await this.repository.createSession(
      identity,
      hash(sessionToken),
      expiresAt,
    );
    return { sessionToken, expiresAt };
  }

  async currentSession(token: string) {
    this.requireEnabled();
    if (!validToken(token))
      throw new ApiError(ERRORS.SESSION_MISSING, 'กรุณาเข้าสู่ระบบ');
    const session = await this.repository.findSession(hash(token));
    if (!session)
      throw new ApiError(ERRORS.SESSION_MISSING, 'กรุณาเข้าสู่ระบบ');
    if (session.revokedAt)
      throw new ApiError(
        ERRORS.SESSION_REVOKED,
        'session ถูกเพิกถอน กรุณาเข้าสู่ระบบใหม่',
      );
    if (session.expiresAt.getTime() <= Date.now())
      throw new ApiError(
        ERRORS.SESSION_EXPIRED,
        'session หมดอายุ กรุณาเข้าสู่ระบบใหม่',
      );
    return {
      user: session.user,
      expiresAt: session.expiresAt.toISOString(),
      csrfToken: this.csrfToken(token),
    };
  }

  /** Guard ตรวจ Origin + CSRF ก่อนให้คำขอที่เปลี่ยนข้อมูลเข้าถึง controller */
  assertCsrf(token: string, origin: string | undefined, csrf: unknown): void {
    if (
      !this.config.origins.includes(origin ?? '') ||
      typeof csrf !== 'string' ||
      !equalTokens(this.csrfToken(token), csrf)
    ) {
      throw new ApiError(ERRORS.CSRF_INVALID, 'คำขอไม่ผ่านการตรวจ CSRF');
    }
  }

  async logout(token: string): Promise<void> {
    await this.repository.revokeSession(hash(token));
  }

  private csrfToken(token: string): string {
    return createHmac('sha256', token).update('aokkorn-csrf-v1').digest('hex');
  }

  private invalidCallback(): never {
    throw new ApiError(
      ERRORS.LINE_CALLBACK_INVALID,
      'คำขอเข้าสู่ระบบไม่ถูกต้อง ถูกยกเลิก หรือหมดอายุ กรุณาเริ่มใหม่',
    );
  }

  private requireEnabled(): void {
    if (!this.config.enabled)
      throw new ApiError(
        ERRORS.LINE_PROVIDER_UNAVAILABLE,
        'ยังไม่ได้ตั้งค่า LINE Login',
      );
  }
}
