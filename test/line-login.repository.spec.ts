import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { LineLoginConfig } from '../src/api/line-login/line-login.config.js';

const pg = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
  end: vi.fn(),
  options: vi.fn(),
}));
vi.mock('pg', () => ({
  Pool: class {
    constructor(options: unknown) {
      pg.options(options);
    }
    on = vi.fn();
    connect = pg.connect;
    query = pg.query;
    end = pg.end;
  },
}));
import { LineLoginRepository } from '../src/api/line-login/line-login.repository.js';

const config = (extra = {}) =>
  new LineLoginConfig(
    new ConfigService({
      NODE_ENV: 'test',
      LINE_LOGIN_ENABLED: 'true',
      LINE_CHANNEL_ID: '123',
      LINE_CHANNEL_SECRET: 'secret',
      DATABASE_URL: 'postgresql://test:test@localhost/test',
      ...extra,
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  pg.query.mockReset().mockResolvedValue({ rows: [{ id: 'user-1' }] });
  pg.connect.mockResolvedValue({ query: pg.query, release: pg.release });
});

describe('LINE Login repository transactions (no live database)', () => {
  it('upserts user and inserts only hashed session token in one transaction', async () => {
    const repository = new LineLoginRepository(config());
    const expiresAt = new Date(Date.now() + 60000);
    await repository.createSession(
      { subject: 'line-subject', displayName: 'ชื่อ' },
      'hash-only',
      expiresAt,
    );
    expect(pg.query.mock.calls[0]![0]).toBe('BEGIN');
    expect(pg.query.mock.calls[1]![1]).toEqual(['line-subject', 'ชื่อ']);
    expect(pg.query.mock.calls[2]![1]).toEqual([
      'user-1',
      'hash-only',
      expiresAt,
    ]);
    expect(pg.query.mock.calls[3]![0]).toBe('COMMIT');
    expect(pg.release).toHaveBeenCalledWith(false);
  });
  it('rolls back the user upsert if session insertion fails', async () => {
    pg.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('INSERT INTO public.sessions'))
        throw new Error('insert failed');
      return { rows: [{ id: 'user-1' }] };
    });
    await expect(
      new LineLoginRepository(config()).createSession(
        { subject: 'line', displayName: 'ชื่อ' },
        'hash',
        new Date(),
      ),
    ).rejects.toThrow();
    expect(pg.query.mock.calls.map((call) => call[0])).toContain('ROLLBACK');
    expect(pg.query.mock.calls.map((call) => call[0])).not.toContain('COMMIT');
    expect(pg.release).toHaveBeenCalledWith(false);
  });
  it('discards a connection if rollback fails', async () => {
    pg.query.mockImplementation(async (sql: string) => {
      if (sql === 'ROLLBACK' || sql.startsWith('INSERT INTO public.sessions'))
        throw new Error('failed');
      return { rows: [{ id: 'user-1' }] };
    });
    await expect(
      new LineLoginRepository(config()).createSession(
        { subject: 'line', displayName: 'ชื่อ' },
        'hash',
        new Date(),
      ),
    ).rejects.toThrow();
    expect(pg.release).toHaveBeenCalledWith(true);
  });
  it('requires verified TLS for remote PostgreSQL', () => {
    new LineLoginRepository(
      config({
        DATABASE_URL: 'postgresql://u:p@db.example/postgres?ssl=no-verify',
      }),
    );
    expect(pg.options).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: { rejectUnauthorized: true } }),
    );
    expect(
      () =>
        new LineLoginRepository(
          config({
            DATABASE_URL:
              'postgresql://u:p@db.example/postgres?sslmode=disable',
          }),
        ),
    ).toThrow();
  });
  it('opens no pool while login is disabled', () => {
    new LineLoginRepository(config({ LINE_LOGIN_ENABLED: 'false' }));
    expect(pg.options).not.toHaveBeenCalled();
  });
});
