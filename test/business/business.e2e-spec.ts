import 'reflect-metadata';
import {
  Logger,
  type INestApplication,
  type ExecutionContext,
} from '@nestjs/common';
import request from 'supertest';
import { testBackend } from '../support/test-backend.js';
import { setupApp } from '../../src/app.setup.js';
import {
  SessionGuard,
  type AuthenticatedRequest,
} from '../../src/api/line-login/session.guard.js';
import { ApiError, ERRORS } from '../../src/common/api-error.filter.js';
/** HTTP scenario สำหรับผู้ใช้รันเอง: มีพอร์ตชั่วคราว; actor/CSRF จำลองเฉพาะใน test นี้ ไม่มี production bypass */
describe('All 25 business HTTP endpoints against isolated PostgreSQL', () => {
  let backend: Awaited<ReturnType<typeof testBackend>>;
  let app: INestApplication;
  let owner: string;
  beforeAll(async () => {
    backend = await testBackend();
    owner = await backend.user();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.spyOn(SessionGuard.prototype, 'canActivate').mockImplementation(
      async (context: ExecutionContext) => {
        const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
        const actor = req.headers['x-test-user'];
        if (typeof actor !== 'string')
          throw new ApiError(ERRORS.SESSION_MISSING, 'test session missing');
        if (
          !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
          (req.headers.origin !== 'http://localhost:3000' ||
            req.headers['x-csrf-token'] !== 'test-csrf')
        )
          throw new ApiError(ERRORS.CSRF_INVALID, 'test CSRF invalid');
        req.auth = {
          user: { id: actor, displayName: 'test' },
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          csrfToken: 'test-csrf',
        };
        return true;
      },
    );
    app = backend.module.createNestApplication({ logger: false });
    setupApp(app);
    await app.listen(0, '127.0.0.1');
  }, 30000);
  afterAll(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });
  function call(
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: Record<string, unknown>,
  ) {
    const test = request(app.getHttpServer())
      [method]('/api/v1' + path)
      .set('x-test-user', owner)
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', 'test-csrf');
    return body === undefined ? test : test.send(body);
  }
  it('runs the full user journey through HTTP, including static deleted route and all child endpoints', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/trips')
      .expect(401)
      .expect((r) => expect(r.body.errorCode).toBe('AOK-1001'));
    await call('get', '/currencies').expect(200);
    const trip = (
      await call('post', '/trips', {
        name: 'HTTP trip',
        baseCurrency: 'THB',
      }).expect(201)
    ).body;
    const base = '/trips/' + trip.id;
    await call('get', '/trips').expect(200);
    await call('get', base).expect(200);
    await call('get', '/trips/deleted').expect(200);
    await call('get', '/trips?ownerUserId=forged').expect(400);
    await call('post', '/trips', {
      name: 'forged',
      baseCurrency: 'THB',
      ownerUserId: 'forged',
    }).expect(400);
    const guest = (
      await call('post', base + '/participants', { displayName: 'B' }).expect(
        201,
      )
    ).body;
    await call('patch', base + '/participants/' + guest.id, {
      displayName: 'เพื่อน B',
    }).expect(200);
    const day = (await call('post', base + '/days', {}).expect(201)).body;
    await call('patch', base + '/days/' + day.id, { name: 'วันที่สอง' }).expect(
      200,
    );
    await call('post', base + '/expenses/parse', {
      text: 'อาหาร 1,000.01',
      currency: 'THB',
    }).expect(200);
    const input = {
      dayId: day.id,
      name: 'อาหาร',
      amount: { minor: '100001', currency: 'THB' },
      payerParticipantId: trip.participants[0].id,
      participantIds: [guest.id],
    };
    await call('post', base + '/expenses/preview', input).expect(200);
    const expense = (await call('post', base + '/expenses', input).expect(201))
      .body;
    await call('get', base + '/expenses/' + expense.id).expect(200);
    await call('get', base + '/days/' + day.id + '/expenses').expect(200);
    await call('patch', base + '/expenses/' + expense.id, {
      name: 'อาหารมื้อแรก',
    }).expect(200);
    await call('get', base + '/summary')
      .expect(200)
      .expect((r) => expect(r.body.obligations).toHaveLength(1));
    const settlement =
      base + '/obligations/' + expense.obligations[0].id + '/settlement';
    await call('post', settlement + '/preview', { currency: 'THB' }).expect(
      200,
    );
    const payment = { paidAmount: expense.obligations[0].amount };
    const paid = (await call('put', settlement, payment).expect(200)).body;
    await call('put', settlement, payment)
      .expect(200)
      .expect((r) =>
        expect(r.body.settlement.paidAt).toBe(paid.settlement.paidAt),
      );
    await call('delete', settlement).expect(200);
    await call('delete', base + '/expenses/' + expense.id).expect(200);
    await call('delete', base + '/participants/' + guest.id).expect(200);
    await call('get', '/exchange-rates/quote?from=JPY&to=THB').expect(200);
    await call('patch', base, { name: 'เปลี่ยนชื่อ' }).expect(200);
    await call('delete', base).expect(200);
    await call('get', '/trips/deleted')
      .expect(200)
      .expect((r) => expect(r.body.items[0].id).toBe(trip.id));
    await call('post', base + '/restore', {}).expect(200);
    await call('get', '/trips/not-a-uuid').expect(400);
    await request(app.getHttpServer())
      .options('/api/v1/trips/' + trip.id)
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'PATCH')
      .expect(204)
      .expect('Access-Control-Allow-Methods', /PATCH/);
  });
});
