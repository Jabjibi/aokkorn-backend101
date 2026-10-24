import 'reflect-metadata';
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { TripsController } from '../../src/api/trips/trips.controller.js';
import { TripsService } from '../../src/api/trips/trips.service.js';
import { TripsRepository } from '../../src/api/trips/trips.repository.js';
import {
  CreateTripPipe,
  EmptyTripQueryPipe,
  parseCreateTrip,
  totalsByCurrency,
  type TripView,
} from '../../src/api/trips/trips.dto.js';
import {
  SessionGuard,
  type AuthenticatedRequest,
} from '../../src/api/line-login/session.guard.js';
import { LineLoginService } from '../../src/api/line-login/line-login.service.js';
import { LineLoginCookies } from '../../src/api/line-login/line-login.cookies.js';
import { ParseUUIDPipe, type ExecutionContext } from '@nestjs/common';

function trip(minor: string, currency = 'THB'): TripView {
  return {
    id: 'trip',
    name: 'ทะเล',
    baseCurrency: currency,
    createdAt: '2026-10-23T00:00:00.000Z',
    updatedAt: '2026-10-23T00:00:00.000Z',
    participantCount: 1,
    expenseCount: 0,
    total: { minor, currency },
    originalTotals: [],
  };
}

describe('Trip input and money (pure)', () => {
  it('trims name without mutating input and validates through the HTTP pipe', () => {
    const input = Object.freeze({ name: '  ทะเล  ', baseCurrency: 'THB' });
    expect(new CreateTripPipe().transform(input)).toEqual({
      name: 'ทะเล',
      baseCurrency: 'THB',
    });
    expect(input.name).toBe('  ทะเล  ');
  });
  it.each([
    null,
    [],
    'ทริป',
    {},
    { name: 'x'.repeat(81), baseCurrency: 'THB' },
    { name: 12, baseCurrency: 'THB' },
    { name: 'ทริป', baseCurrency: 'thb' },
    { name: 'ทริป', baseCurrency: 123 },
    { name: 'ทริป', baseCurrency: 'THB', ownerUserId: 'someone-else' },
    { name: 'ทริป', baseCurrency: 'THB', id: 'client-id' },
  ])('rejects malformed or system-controlled fields: %j', (input) => {
    expect(() => parseCreateTrip(input)).toThrow(
      expect.objectContaining({ errorCode: 'AOK-9001' }),
    );
  });
  it('returns the specified error for a blank name', () => {
    expect(() => parseCreateTrip({ name: ' ', baseCurrency: 'THB' })).toThrow(
      expect.objectContaining({ errorCode: 'AOK-2201' }),
    );
  });
  it('accepts an empty query and rejects unknown query parameters', () => {
    const pipe = new EmptyTripQueryPipe();
    expect(pipe.transform({})).toBeUndefined();
    expect(() => pipe.transform({ ownerUserId: 'other' })).toThrow(
      expect.objectContaining({ errorCode: 'AOK-9001' }),
    );
  });
  it('preserves integer money beyond Number precision and keeps currencies separate', () => {
    const input = [trip('9007199254740993'), trip('10'), trip('125', 'USD')];
    expect(totalsByCurrency(input)).toEqual([
      { currency: 'THB', minor: '9007199254741003' },
      { currency: 'USD', minor: '125' },
    ]);
    expect(input[0]!.total.minor).toBe('9007199254740993');
    expect(totalsByCurrency([])).toEqual([]);
  });
});

describe('Trip HTTP boundary and access guard (no server)', () => {
  it('validates UUIDs through the pipe registered on the detail route', async () => {
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      TripsController,
      'detail',
    ) as Record<string, { pipes: unknown[] }>;
    const pipe = Object.values(args)
      .flatMap((arg) => arg.pipes)
      .find((p) => p instanceof ParseUUIDPipe) as ParseUUIDPipe;
    expect(pipe).toBeInstanceOf(ParseUUIDPipe);
    const id = '11b93398-395e-42c0-ac32-46a6ac15c5b3';
    await expect(pipe.transform(id, { type: 'param' })).resolves.toBe(id);
    await expect(pipe.transform('1', { type: 'param' })).rejects.toMatchObject({
      errorCode: 'AOK-9001',
    });
  });
  it('registers SessionGuard for every Trip route and propagates only the session actor', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, TripsController)).toContain(
      SessionGuard,
    );
    const repository = {
      list: vi.fn().mockResolvedValue([trip('100')]),
      create: vi.fn(),
      detail: vi.fn(),
    };
    const service = new TripsService(repository as unknown as TripsRepository);
    const controller = new TripsController(service);
    const request = {
      auth: { user: { id: 'session-owner' } },
      body: { ownerUserId: 'forged' },
      query: { ownerUserId: 'forged' },
    } as unknown as AuthenticatedRequest;
    expect(await controller.list(request)).toMatchObject({
      quota: { used: 1, limit: 5, remaining: 4 },
      totalsByCurrency: [{ currency: 'THB', minor: '100' }],
    });
    expect(repository.list).toHaveBeenCalledWith('session-owner');
    controller.create(request, { name: 'ทะเล', baseCurrency: 'THB' });
    expect(repository.create).toHaveBeenCalledWith('session-owner', {
      name: 'ทะเล',
      baseCurrency: 'THB',
    });
    controller.detail(request, 'trip-id');
    expect(repository.detail).toHaveBeenCalledWith('session-owner', 'trip-id');
  });
  it('requires authentication on reads and CSRF on creates before the controller runs', async () => {
    const login = {
      currentSession: vi.fn().mockResolvedValue({ user: { id: 'owner' } }),
      assertCsrf: vi.fn(),
    };
    const cookies = { read: vi.fn().mockReturnValue('session-token') };
    const guard = new SessionGuard(
      login as unknown as LineLoginService,
      cookies as unknown as LineLoginCookies,
    );
    const request = {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'x-csrf-token': 'csrf' },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(login.assertCsrf).toHaveBeenCalledWith(
      'session-token',
      'http://localhost:3000',
      'csrf',
    );
    login.assertCsrf.mockImplementation(() => {
      throw new Error('invalid-csrf');
    });
    await expect(guard.canActivate(context)).rejects.toThrow('invalid-csrf');
    request.method = 'GET';
    login.assertCsrf.mockClear();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(login.assertCsrf).not.toHaveBeenCalled();
    login.currentSession.mockRejectedValue(new Error('missing-session'));
    await expect(guard.canActivate(context)).rejects.toThrow('missing-session');
  });
});
