import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { LineLoginConfig } from '../src/api/line-login/line-login.config.js';
import { LineClient } from '../src/api/line-login/line.client.js';
import { LineLoginCookies } from '../src/api/line-login/line-login.cookies.js';
import type { Response as ExpressResponse } from 'express';

const config = (extra = {}) =>
  new LineLoginConfig(new ConfigService({ NODE_ENV: 'test', ...extra }));

describe('LINE configuration and cookies', () => {
  it('can start without credentials while login is disabled', () => {
    expect(config()).toMatchObject({
      enabled: false,
      port: 5016,
      sessionTtlMs: 168 * 3_600_000,
    });
  });
  it.each([
    { LINE_LOGIN_ENABLED: 'true' },
    { PORT: '0' },
    { SESSION_TTL_HOURS: 'Infinity' },
    { LINE_LOGIN_ENABLED: 'yes' },
    { NODE_ENV: 'production' },
    { DATABASE_URL: 'private-invalid-value' },
    { LINE_CALLBACK_URL: 'http://localhost:5016/wrong' },
    { LOGIN_SUCCESS_URL: 'https://evil.example' },
    { ALLOWED_ORIGINS: '*' },
    { SESSION_COOKIE_SAME_SITE: 'none' },
  ])('rejects invalid config %j', (extra) => {
    expect(() => config(extra)).toThrow();
  });
  it('config errors identify the key without exposing the value', () => {
    try {
      config({ DATABASE_URL: 'private-invalid-value' });
    } catch (error) {
      expect(String(error)).toContain('DATABASE_URL');
      expect(String(error)).not.toContain('private-invalid-value');
    }
  });
  it.each(['lax', 'strict', 'none'])(
    'production cookie SameSite=%s preserves secure flags and Lax flow cookie',
    (sameSite) => {
      const settings = config({
        NODE_ENV: 'production',
        LINE_LOGIN_ENABLED: 'true',
        LINE_CHANNEL_ID: '123',
        LINE_CHANNEL_SECRET: 'secret',
        DATABASE_URL: 'postgresql://u:p@db.example/postgres',
        ALLOWED_ORIGINS: 'https://app.example.com',
        LINE_CALLBACK_URL: 'https://api.example.com/api/v1/auth/line/callback',
        LOGIN_SUCCESS_URL: 'https://app.example.com',
        SESSION_COOKIE_SAME_SITE: sameSite,
      });
      const cookies = new LineLoginCookies(settings);
      const response = {
        cookie: vi.fn(),
        clearCookie: vi.fn(),
      } as unknown as ExpressResponse;
      cookies.writeFlow(response, 'flow');
      cookies.writeSession(response, 'session', new Date());
      cookies.clearSession(response);
      expect(response.cookie).toHaveBeenCalledWith(
        '__Host-aokkorn_flow',
        'flow',
        expect.objectContaining({
          secure: true,
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
        }),
      );
      expect(response.cookie).toHaveBeenCalledWith(
        '__Host-aokkorn_session',
        'session',
        expect.objectContaining({
          secure: true,
          httpOnly: true,
          path: '/',
          sameSite,
        }),
      );
      expect(response.clearCookie).toHaveBeenCalledWith(
        '__Host-aokkorn_session',
        expect.objectContaining({ secure: true, path: '/', sameSite }),
      );
    },
  );
});

describe('LINE client', () => {
  function fixture(claims = {}) {
    const settings = config({
      LINE_CHANNEL_ID: '123',
      LINE_CHANNEL_SECRET: 'secret',
    });
    const now = Math.floor(Date.now() / 1000);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id_token: 'id-token' }))
      .mockResolvedValueOnce(
        Response.json({
          iss: 'https://access.line.me',
          aud: '123',
          nonce: 'nonce',
          iat: now,
          exp: now + 300,
          sub: 'line-user',
          name: 'ชื่อผู้ใช้',
          ...claims,
        }),
      );
    return { fetcher, client: new LineClient(settings, fetcher) };
  }
  it('uses PKCE S256 and exact redirect URI, keeping secret out of authorize URL', async () => {
    const f = fixture();
    const url = new URL(
      f.client.authorizationUrl('state', 'nonce', 'verifier'),
    );
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update('verifier').digest('base64url'),
    );
    expect(url.searchParams.has('client_secret')).toBe(false);
    expect(await f.client.verifyCode('code', 'verifier', 'nonce')).toEqual({
      subject: 'line-user',
      displayName: 'ชื่อผู้ใช้',
    });
    const body = f.fetcher.mock.calls[0]![1]!.body as URLSearchParams;
    expect(body.get('code_verifier')).toBe('verifier');
    expect(body.get('client_secret')).toBe('secret');
    const verify = f.fetcher.mock.calls[1]![1]!.body as URLSearchParams;
    expect(verify.get('nonce')).toBe('nonce');
  });
  it.each([
    { iss: 'wrong' },
    { aud: 'wrong' },
    { nonce: 'wrong' },
    { exp: 0 },
    { iat: 9999999999 },
  ])('rejects invalid claims %j', async (claims) => {
    const f = fixture(claims);
    await expect(
      f.client.verifyCode('code', 'verifier', 'nonce'),
    ).rejects.toMatchObject({ errorCode: 'AOK-1101' });
  });
  it.each([400, 401, 429, 503])(
    'handles upstream HTTP %i safely',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('provider-private-body', { status }));
      const client = new LineClient(config(), fetcher);
      await expect(
        client.verifyCode('code', 'verifier', 'nonce'),
      ).rejects.toMatchObject({
        errorCode: status < 429 ? 'AOK-1101' : 'AOK-1103',
      });
    },
  );
  it.each(['not-json', 'x'.repeat(32769), '[]'])(
    'rejects malformed or oversized response',
    async (body) => {
      const client = new LineClient(
        config(),
        vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
      );
      await expect(
        client.verifyCode('code', 'verifier', 'nonce'),
      ).rejects.toMatchObject({ errorCode: 'AOK-1102' });
    },
  );
});
