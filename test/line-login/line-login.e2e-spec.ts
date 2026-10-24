import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  Controller,
  Module,
  Post,
  UseGuards,
  type INestApplication,
} from '@nestjs/common';
import request from 'supertest';
import { createHash, randomBytes } from 'node:crypto';
import { AppModule } from '../../src/app.module.js';
import { setupApp } from '../../src/app.setup.js';
import { LineLoginConfig } from '../../src/api/line-login/line-login.config.js';
import { LineLoginModule } from '../../src/api/line-login/line-login.module.js';
import { SessionGuard } from '../../src/api/line-login/session.guard.js';
import {
  LINE_FETCH,
  type LineIdentity,
} from '../../src/api/line-login/line.client.js';
import {
  LineLoginRepository,
  type StoredSession,
} from '../../src/api/line-login/line-login.repository.js';

const origin = 'http://localhost:3000';
const config = () =>
  new LineLoginConfig(
    new ConfigService({
      NODE_ENV: 'test',
      LINE_LOGIN_ENABLED: 'true',
      LINE_CHANNEL_ID: '123',
      LINE_CHANNEL_SECRET: 'test-secret',
      DATABASE_URL: 'postgresql://test:test@localhost/test',
    }),
  );

@Controller('test-protected')
class ProtectedController {
  @Post()
  @UseGuards(SessionGuard)
  create() {
    return { ok: true };
  }
}
@Module({ imports: [LineLoginModule], controllers: [ProtectedController] })
class ProtectedModule {}

describe('LINE Login HTTP (mock LINE and database)', () => {
  let app: INestApplication;
  let sessions: Map<string, StoredSession>;
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  let repository: {
    createSession: ReturnType<typeof vi.fn>;
    findSession: ReturnType<typeof vi.fn>;
    revokeSession: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    sessions = new Map();
    repository = {
      createSession: vi.fn(
        async (identity: LineIdentity, hash: string, expiresAt: Date) => {
          sessions.set(hash, {
            user: { id: 'user-1', displayName: identity.displayName },
            expiresAt,
            revokedAt: null,
          });
        },
      ),
      findSession: vi.fn(async (hash: string) => sessions.get(hash) ?? null),
      revokeSession: vi.fn(async (hash: string) => {
        const value = sessions.get(hash);
        if (value) value.revokedAt = new Date();
      }),
    };
    fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      if (String(url).endsWith('/token'))
        return Response.json({ id_token: 'test-id-token' });
      const body = options!.body as URLSearchParams;
      const now = Math.floor(Date.now() / 1000);
      return Response.json({
        iss: 'https://access.line.me',
        aud: '123',
        nonce: body.get('nonce'),
        iat: now,
        exp: now + 300,
        sub: 'test-line-subject',
        name: 'ผู้ทดสอบ',
      });
    });
    const module = await Test.createTestingModule({
      imports: [AppModule, ProtectedModule],
    })
      .overrideProvider(LineLoginConfig)
      .useValue(config())
      .overrideProvider(LineLoginRepository)
      .useValue(repository)
      .overrideProvider(LINE_FETCH)
      .useValue(fetcher)
      .compile();
    app = module.createNestApplication({ logger: false });
    setupApp(app);
    await app.listen(0, '127.0.0.1');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });

  async function start() {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/line/start')
      .expect(302);
    const url = new URL(response.headers.location as string);
    expect(url.origin).toBe('https://access.line.me');
    expect(url.searchParams.get('scope')).toBe('openid profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.has('client_secret')).toBe(false);
    const cookie = (
      response.headers['set-cookie'] as unknown as string[]
    )[0]!.split(';')[0]!;
    return {
      cookie,
      state: url.searchParams.get('state')!,
      nonce: url.searchParams.get('nonce')!,
    };
  }
  async function login() {
    const flow = await start();
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/line/callback')
      .query({ code: 'test-code', state: flow.state })
      .set('Cookie', flow.cookie)
      .expect(303);
    expect(response.headers.location).toBe(config().successUrl);
    const cookie = (response.headers['set-cookie'] as unknown as string[]).find(
      (value) => value.startsWith('aokkorn_session='),
    )!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    return { cookie: cookie.split(';')[0]!, flow };
  }

  it('login → me → protected request → logout revokes immediately', async () => {
    const { cookie } = await login();
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body.user).toEqual({ id: 'user-1', displayName: 'ผู้ทดสอบ' });
    expect(me.headers['cache-control']).toBe('no-store');
    const raw = cookie.split('=')[1]!;
    expect(sessions.has(createHash('sha256').update(raw).digest('hex'))).toBe(
      true,
    );
    expect(JSON.stringify(me.body)).not.toContain(raw);
    expect(JSON.stringify(me.body)).not.toContain('test-line-subject');
    await request(app.getHttpServer())
      .post('/api/v1/test-protected')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', me.body.csrfToken as string)
      .expect(201);
    const logout = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', me.body.csrfToken as string)
      .expect(204);
    expect(logout.headers['set-cookie'][0]).toContain('aokkorn_session=;');
    const revoked = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(401);
    expect(revoked.body.errorCode).toBe('AOK-1003');
  });

  it('missing and expired sessions return stable codes', async () => {
    const missing = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .expect(401);
    expect(missing.body).toMatchObject({
      statusCode: 401,
      errorCode: 'AOK-1001',
      details: {},
      traceId: expect.any(String),
    });
    const { cookie } = await login();
    for (const session of sessions.values()) session.expiresAt = new Date(0);
    const expired = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(401);
    expect(expired.body.errorCode).toBe('AOK-1002');
  });

  it('wrong browser cannot consume the owner flow; callback replay is rejected', async () => {
    const flow = await start();
    await request(app.getHttpServer())
      .get('/api/v1/auth/line/callback')
      .query({ code: 'code', state: flow.state })
      .set('Cookie', `aokkorn_flow=${randomBytes(32).toString('hex')}`)
      .expect(400);
    expect(fetcher).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .get('/api/v1/auth/line/callback')
      .query({ code: 'code', state: flow.state })
      .set('Cookie', flow.cookie)
      .expect(303);
    const replay = await request(app.getHttpServer())
      .get('/api/v1/auth/line/callback')
      .query({ code: 'code', state: flow.state })
      .set('Cookie', flow.cookie)
      .expect(400);
    expect(replay.body.errorCode).toBe('AOK-1101');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('expired flow is rejected before provider I/O', async () => {
    const flow = await start();
    const future = Date.now() + config().flowTtlMs + 1;
    vi.spyOn(Date, 'now').mockReturnValue(future);
    const expired = await request(app.getHttpServer())
      .get('/api/v1/auth/line/callback')
      .query({ code: 'code', state: flow.state })
      .set('Cookie', flow.cookie)
      .expect(400);
    expect(expired.body.errorCode).toBe('AOK-1101');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('denied callback clears cookie and consumes state', async () => {
    const flow = await start();
    const denied = await request(app.getHttpServer())
      .get('/api/v1/auth/line/callback')
      .query({ error: 'access_denied', state: flow.state })
      .set('Cookie', flow.cookie)
      .expect(400);
    expect(denied.headers['set-cookie'][0]).toContain('aokkorn_flow=;');
    await request(app.getHttpServer())
      .get('/api/v1/auth/line/callback')
      .query({ code: 'code', state: flow.state })
      .set('Cookie', flow.cookie)
      .expect(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('duplicate query/cookies and missing browser cookie are rejected', async () => {
    const flow = await start();
    await request(app.getHttpServer())
      .get('/api/v1/auth/line/callback')
      .query({ code: ['one', 'two'], state: flow.state })
      .set('Cookie', flow.cookie)
      .expect(400);
    const other = await start();
    await request(app.getHttpServer())
      .get('/api/v1/auth/line/callback')
      .query({ code: 'code', state: other.state })
      .set('Cookie', `${other.cookie}; ${other.cookie}`)
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/auth/line/callback')
      .query({ code: 'code', state: other.state })
      .expect(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { Origin: 'https://evil.example' },
    { Origin: origin, 'X-CSRF-Token': 'wrong' },
  ])('invalid mutation headers %j cannot logout', async (headers) => {
    const { cookie } = await login();
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set(headers)
      .expect(403);
    expect(response.body.errorCode).toBe('AOK-1201');
    expect(repository.revokeSession).not.toHaveBeenCalled();
  });

  it('CORS allows only configured origins', async () => {
    const allowed = await request(app.getHttpServer())
      .options('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST');
    expect(allowed.headers['access-control-allow-origin']).toBe(origin);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const blocked = await request(app.getHttpServer())
      .options('/api/v1/auth/logout')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('upstream failure creates no session and hides transport details', async () => {
    fetcher.mockRejectedValue(new Error('private-provider-details'));
    const flow = await start();
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/line/callback')
      .query({ code: 'code', state: flow.state })
      .set('Cookie', flow.cookie)
      .expect(503);
    expect(response.body.errorCode).toBe('AOK-1103');
    expect(JSON.stringify(response.body)).not.toContain(
      'private-provider-details',
    );
    expect(repository.createSession).not.toHaveBeenCalled();
  });

  it('database failure does not issue a session cookie or reveal SQL', async () => {
    repository.createSession.mockRejectedValue(
      new Error('private SQL and password'),
    );
    const flow = await start();
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/line/callback')
      .query({ code: 'code', state: flow.state })
      .set('Cookie', flow.cookie)
      .expect(500);
    expect(response.body.errorCode).toBe('AOK-9000');
    expect(JSON.stringify(response.body)).not.toContain('private SQL');
    expect(
      (response.headers['set-cookie'] as unknown as string[]).some((cookie) =>
        cookie.startsWith('aokkorn_session='),
      ),
    ).toBe(false);
  });

  it('limits login starts', async () => {
    for (let i = 0; i < 20; i++)
      await request(app.getHttpServer())
        .get('/api/v1/auth/line/start')
        .expect(302);
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/line/start')
      .expect(429);
    expect(response.body.errorCode).toBe('AOK-9002');
  });
});
