import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DatabaseService } from '../../src/database/database.service.js';
import { TripsRepository } from '../../src/api/trips/trips.repository.js';
import { AppModule } from '../../src/app.module.js';

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
    query = pg.query;
    connect = pg.connect;
    end = pg.end;
  },
}));
const ownerId = '7e5dfb79-3cb7-42f2-af88-d1fda8a9ef54';
const tripId = '11b93398-395e-42c0-ac32-46a6ac15c5b3';
const time = new Date('2026-10-23T00:00:00.000Z');
const trip = {
  id: tripId,
  name: 'ทะเล',
  base_currency_code: 'THB',
  created_at: time,
  updated_at: time,
  participant_count: 1,
  expense_count: 0,
  total_minor: '0',
  original_totals: [],
  missing_rate: false,
};
const participant = {
  id: 'person',
  display_name: 'เจ้าของ',
  sort_order: 1,
  is_owner: true,
  created_at: time,
  updated_at: time,
};
const day = {
  id: 'day',
  name: 'วัน 1',
  sort_order: 1,
  created_at: time,
  updated_at: time,
  expense_count: 0,
  total_minor: '0',
  original_totals: [],
  missing_rate: false,
};
function config() {
  return new ConfigService({
    NODE_ENV: 'test',
    LINE_LOGIN_ENABLED: 'false',
    DATABASE_URL: 'postgresql://test:test@localhost/test',
  });
}
function fixture() {
  return new TripsRepository(new DatabaseService(config()));
}
// จำลองเฉพาะผล query; ไม่เปิด connection และไม่ใช้ .env/Supabase จริง
async function answer(sql: string) {
  if (sql.startsWith('SELECT display_name'))
    return { rows: [{ display_name: 'เจ้าของ' }] };
  if (sql.startsWith('SELECT count(*)')) return { rows: [{ count: 4 }] };
  if (sql.startsWith('SELECT code')) return { rows: [{ code: 'THB' }] };
  if (sql.startsWith('INSERT INTO public.trips'))
    return { rows: [{ id: tripId }] };
  if (sql.startsWith('SELECT t.id')) return { rows: [{ ...trip }] };
  if (sql.startsWith('SELECT id,display_name'))
    return { rows: [{ ...participant }] };
  if (sql.startsWith('SELECT d.id')) return { rows: [{ ...day }] };
  return { rows: [] };
}
beforeEach(() => {
  vi.clearAllMocks();
  pg.query.mockReset().mockImplementation(answer);
  pg.connect.mockResolvedValue({ query: pg.query, release: pg.release });
});

describe('Trip repository transactions and ownership (mock PostgreSQL)', () => {
  it('locks owner before counting quota and commits trip, owner participant and day together', async () => {
    const result = await fixture().create(ownerId, {
      name: 'ทะเล',
      baseCurrency: 'THB',
    });
    const calls = pg.query.mock.calls;
    expect(calls[0]![0]).toBe('BEGIN ISOLATION LEVEL READ COMMITTED');
    expect(calls[1]![0]).toContain('FOR UPDATE');
    expect(calls[1]![1]).toEqual([ownerId]);
    expect(calls[2]![0]).toContain('deleted_at IS NULL');
    expect(calls[4]![1]).toEqual([ownerId, 'ทะเล', 'THB']);
    expect(calls[5]![0]).toContain('is_owner');
    expect(calls[5]![1]).toEqual([tripId, 'เจ้าของ']);
    expect(calls[6]![1]).toEqual([tripId, 'วัน 1']);
    expect(calls.at(-1)![0]).toBe('COMMIT');
    expect(pg.release).toHaveBeenCalledWith(false);
    expect(result).toMatchObject({
      id: tripId,
      createdAt: time.toISOString(),
      total: { minor: '0', currency: 'THB' },
      participants: [{ isOwner: true, displayName: 'เจ้าของ' }],
      days: [{ name: 'วัน 1' }],
    });
    expect(result).not.toHaveProperty('ownerUserId');
  });
  it('rejects quota >= 5 before any insert and rolls back', async () => {
    pg.query.mockImplementation((sql: string) =>
      sql.startsWith('SELECT count(*)')
        ? Promise.resolve({ rows: [{ count: 5 }] })
        : answer(sql),
    );
    await expect(
      fixture().create(ownerId, { name: 'ทะเล', baseCurrency: 'THB' }),
    ).rejects.toMatchObject({
      errorCode: 'AOK-2101',
      details: { activeTripCount: 5, limit: 5 },
    });
    expect(pg.query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(
      false,
    );
    expect(pg.query).toHaveBeenLastCalledWith('ROLLBACK');
  });
  it('rejects currency absent from the reference table without inserting', async () => {
    pg.query.mockImplementation((sql: string) =>
      sql.startsWith('SELECT code')
        ? Promise.resolve({ rows: [] })
        : answer(sql),
    );
    await expect(
      fixture().create(ownerId, { name: 'ทะเล', baseCurrency: 'ZZZ' }),
    ).rejects.toMatchObject({ errorCode: 'AOK-2202' });
    expect(pg.query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(
      false,
    );
    expect(pg.query).toHaveBeenLastCalledWith('ROLLBACK');
  });
  it.each(['participants', 'trip_days'])(
    'rolls back all writes when %s insertion fails',
    async (table) => {
      pg.query.mockImplementation((sql: string) => {
        if (sql.startsWith(`INSERT INTO public.${table}`))
          throw new Error('write-failed');
        return answer(sql);
      });
      await expect(
        fixture().create(ownerId, { name: 'ทะเล', baseCurrency: 'THB' }),
      ).rejects.toThrow('write-failed');
      expect(pg.query).toHaveBeenLastCalledWith('ROLLBACK');
      expect(pg.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
      expect(pg.release).toHaveBeenCalledWith(false);
    },
  );
  it('uses one owner-filtered query for the list and preserves money as a string', async () => {
    pg.query.mockResolvedValue({
      rows: [
        {
          ...trip,
          total_minor: '9007199254740993',
          original_totals: [{ minor: '10', currency: 'USD' }],
        },
      ],
    });
    expect(await fixture().list(ownerId)).toMatchObject([
      {
        total: { minor: '9007199254740993', currency: 'THB' },
        originalTotals: [{ minor: '10', currency: 'USD' }],
      },
    ]);
    expect(pg.query).toHaveBeenCalledTimes(1);
    expect(pg.query).toHaveBeenCalledWith(
      expect.stringContaining('t.owner_user_id=$1 AND t.deleted_at IS NULL'),
      [ownerId],
    );
  });
  it('returns 404 for missing/foreign/deleted trips without reading children', async () => {
    pg.query.mockImplementation((sql: string) =>
      sql.startsWith('SELECT t.id')
        ? Promise.resolve({ rows: [] })
        : answer(sql),
    );
    await expect(fixture().detail(ownerId, tripId)).rejects.toMatchObject({
      errorCode: 'AOK-2001',
    });
    expect(pg.query).toHaveBeenCalledWith(
      expect.stringContaining(
        't.owner_user_id=$1 AND t.deleted_at IS NULL AND t.id=$2',
      ),
      [ownerId, tripId],
    );
    expect(
      pg.query.mock.calls.some(([sql]) =>
        sql.startsWith('SELECT id,display_name'),
      ),
    ).toBe(false);
  });
  it('reads trip and children in a consistent read-only snapshot', async () => {
    const detail = await fixture().detail(ownerId, tripId);
    expect(pg.query.mock.calls[0]![0]).toBe(
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    expect(detail.days[0]!.total).toEqual({ minor: '0', currency: 'THB' });
    expect(pg.query).toHaveBeenLastCalledWith('COMMIT');
  });
  it('fails instead of returning an incomplete total when an FX snapshot is missing', async () => {
    pg.query.mockImplementation((sql: string) =>
      sql.startsWith('SELECT t.id')
        ? Promise.resolve({ rows: [{ ...trip, missing_rate: true }] })
        : answer(sql),
    );
    await expect(fixture().detail(ownerId, tripId)).rejects.toMatchObject({
      errorCode: 'AOK-9000',
    });
    expect(pg.query).toHaveBeenLastCalledWith('ROLLBACK');
  });
  it('serializes two creates at the last available slot using the owner row lock', async () => {
    let count = 4;
    let tail = Promise.resolve();
    pg.connect.mockImplementation(async () => {
      let unlock: (() => void) | undefined;
      return {
        release: pg.release,
        query: vi.fn(async (sql: string) => {
          if (sql.includes('FOR UPDATE')) {
            const previous = tail;
            tail = new Promise<void>((resolve) => {
              unlock = resolve;
            });
            await previous;
          }
          if (sql.startsWith('SELECT count(*)')) return { rows: [{ count }] };
          if (sql.startsWith('INSERT INTO public.trips')) count++;
          if (sql === 'COMMIT' || sql === 'ROLLBACK') unlock?.();
          return answer(sql);
        }),
      };
    });
    const repository = fixture();
    const results = await Promise.allSettled([
      repository.create(ownerId, { name: 'A', baseCurrency: 'THB' }),
      repository.create(ownerId, { name: 'B', baseCurrency: 'THB' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { errorCode: 'AOK-2101' } });
    expect(count).toBe(5);
    // เป็น lock simulation เพื่อจับ regression ของลำดับคำสั่ง; ไม่ใช่ concurrency test บน PostgreSQL จริง
  });
  it('registers modules with a single shared pool for auth and trips without starting a server', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(config())
      .compile();
    try {
      expect(module.get(TripsRepository)).toBeInstanceOf(TripsRepository);
      expect(module.get(DatabaseService)).toBeInstanceOf(DatabaseService);
      expect(pg.options).toHaveBeenCalledTimes(1);
    } finally {
      await module.close();
    }
    expect(pg.end).toHaveBeenCalledTimes(1);
  });
});
