import { testBackend } from '../support/test-backend.js';
import { TripsService } from '../../src/api/trips/trips.service.js';
import { TripLifecycleService } from '../../src/api/trips/trip-lifecycle.service.js';
import { ParticipantsService } from '../../src/api/participants/participants.service.js';
import { TripDaysService } from '../../src/api/trip-days/trip-days.service.js';

describe('Trip lifecycle with in-memory PostgreSQL (no server)', () => {
  let app: Awaited<ReturnType<typeof testBackend>>;
  let owner: string;
  beforeAll(async () => {
    app = await testBackend();
  }, 30000);
  beforeEach(async () => {
    await app.reset();
    owner = await app.user();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('creates real UUIDs and children, hides foreign trips, deletes/restores and updates names', async () => {
    const trips = app.module.get(TripsService),
      lifecycle = app.module.get(TripLifecycleService);
    const trip = await trips.create(owner, {
      name: 'ทะเล',
      baseCurrency: 'THB',
    });
    expect(trip.participants).toHaveLength(1);
    expect(trip.days[0]!.name).toBe('วัน 1');
    expect(trip.total).toEqual({ minor: '0', currency: 'THB' });
    const other = await app.user('other');
    await expect(trips.detail(other, trip.id)).rejects.toMatchObject({
      errorCode: 'AOK-2001',
    });
    const people = app.module.get(ParticipantsService),
      days = app.module.get(TripDaysService);
    const guest = await people.create(owner, trip.id, {
      displayName: 'เพื่อน',
    });
    expect(guest.isOwner).toBe(false);
    expect(
      (
        await people.update(owner, trip.id, guest.id, {
          displayName: 'ชื่อใหม่',
        })
      ).displayName,
    ).toBe('ชื่อใหม่');
    const day = await days.create(owner, trip.id, {});
    expect(day.name).toBe('วัน 2');
    expect(
      (await days.update(owner, trip.id, day.id, { name: 'เที่ยวเมือง' })).name,
    ).toBe('เที่ยวเมือง');
    await expect(
      people.remove(owner, trip.id, trip.participants[0]!.id),
    ).rejects.toMatchObject({ errorCode: 'AOK-3202' });
    await people.remove(owner, trip.id, guest.id);
    expect(
      (await lifecycle.update(owner, trip.id, { name: 'ทริปใหม่' })).name,
    ).toBe('ทริปใหม่');
    const removed = await lifecycle.remove(owner, trip.id);
    expect(
      Date.parse(removed.restoreUntil) - Date.parse(removed.deletedAt),
    ).toBe(30 * 86400000);
    await expect(trips.detail(owner, trip.id)).rejects.toMatchObject({
      errorCode: 'AOK-2001',
    });
    expect((await lifecycle.deleted(owner)).items.map((t) => t.id)).toEqual([
      trip.id,
    ]);
    expect((await trips.list(owner)).quota.used).toBe(0);
    expect((await lifecycle.restore(owner, trip.id)).id).toBe(trip.id);
  });
  it('enforces quota, restore quota and the 30-day recovery window using database time', async () => {
    const trips = app.module.get(TripsService),
      lifecycle = app.module.get(TripLifecycleService);
    const first = await trips.create(owner, { name: '1', baseCurrency: 'THB' });
    await lifecycle.remove(owner, first.id);
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        trips.create(owner, { name: String(i + 2), baseCurrency: 'THB' }),
      ),
    );
    await expect(
      trips.create(owner, { name: '6', baseCurrency: 'THB' }),
    ).rejects.toMatchObject({ errorCode: 'AOK-2101' });
    await expect(lifecycle.restore(owner, first.id)).rejects.toMatchObject({
      errorCode: 'AOK-2102',
    });
    await app.pg.query(
      "UPDATE public.trips SET deleted_at=clock_timestamp()-interval '31 days' WHERE id=$1",
      [first.id],
    );
    await expect(lifecycle.restore(owner, first.id)).rejects.toMatchObject({
      errorCode: 'AOK-2103',
    });
    expect((await lifecycle.deleted(owner)).items).toEqual([]);
  });
  it('issues consecutive day numbers and rolls back invalid currency creates', async () => {
    const trips = app.module.get(TripsService),
      days = app.module.get(TripDaysService);
    await expect(
      trips.create(owner, { name: 'bad', baseCurrency: 'ZZZ' }),
    ).rejects.toMatchObject({ errorCode: 'AOK-2202' });
    expect((await trips.list(owner)).items).toEqual([]);
    const trip = await trips.create(owner, { name: 'ok', baseCurrency: 'THB' });
    const created = await Promise.all([
      days.create(owner, trip.id, {}),
      days.create(owner, trip.id, {}),
    ]);
    expect(created.map((d) => d.sortOrder).sort()).toEqual([2, 3]);
  });
});
