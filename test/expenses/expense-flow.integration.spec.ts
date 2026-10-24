import { testBackend } from '../support/test-backend.js';
import { TripsService } from '../../src/api/trips/trips.service.js';
import { TripLifecycleService } from '../../src/api/trips/trip-lifecycle.service.js';
import { ParticipantsService } from '../../src/api/participants/participants.service.js';
import { TripDaysService } from '../../src/api/trip-days/trip-days.service.js';
import { ExpensesService } from '../../src/api/expenses/expenses.service.js';
import { ObligationsService } from '../../src/api/obligations/obligations.service.js';
import { SummaryService } from '../../src/api/summary/summary.service.js';
import { ExchangeRatesService } from '../../src/api/exchange-rates/exchange-rates.service.js';
import type { ExpenseInput } from '../../src/api/expenses/expenses.dto.js';

describe('Expense → shares → obligations → settlement with isolated PostgreSQL', () => {
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
  async function fixture() {
    const trip = await app.module
      .get(TripsService)
      .create(owner, { name: 'เที่ยว', baseCurrency: 'THB' });
    const guest = await app.module
      .get(ParticipantsService)
      .create(owner, trip.id, { displayName: 'B' });
    const draft: ExpenseInput = {
      dayId: trip.days[0]!.id,
      name: 'อาหาร',
      amount: { minor: '100001', currency: 'THB' },
      payerParticipantId: trip.participants[0]!.id,
      participantIds: [guest.id],
    };
    return {
      trip,
      guest,
      draft,
      expenses: app.module.get(ExpensesService),
      payments: app.module.get(ObligationsService),
    };
  }
  it('parses, previews without writes, saves exact shares and makes pay/unpay idempotent', async () => {
    const { trip, guest, draft, expenses, payments } = await fixture();
    const c = await app.module
      .get(ParticipantsService)
      .create(owner, trip.id, { displayName: 'C' });
    draft.participantIds.push(c.id);
    expect(
      await expenses.parse(owner, trip.id, {
        text: 'น้ำ 3 ขวด 1,250.50',
        currency: 'THB',
      }),
    ).toEqual({
      name: 'น้ำ 3 ขวด',
      amount: { minor: '125050', currency: 'THB' },
    });
    const preview = await expenses.preview(owner, trip.id, draft);
    expect(preview.shares.map((s) => s.amount.minor)).toEqual([
      '33334',
      '33334',
      '33333',
    ]);
    expect((await expenses.listDay(owner, trip.id, draft.dayId)).items).toEqual(
      [],
    );
    const created = await expenses.create(owner, trip.id, draft);
    expect(created.obligations).toHaveLength(2);
    expect(
      created.shares.reduce((sum, s) => sum + BigInt(s.amount.minor), 0n),
    ).toBe(100001n);
    const debt = created.obligations.find(
      (o) => o.debtorParticipantId === guest.id,
    )!;
    const input = { paidAmount: debt.amount };
    const paid = await payments.settle(owner, trip.id, debt.id, input);
    expect(paid.status).toBe('paid');
    expect(
      (await payments.settle(owner, trip.id, debt.id, input)).settlement
        ?.paidAt,
    ).toBe(paid.settlement?.paidAt);
    expect(
      (
        await app.pg.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM public.obligation_settlements',
        )
      ).rows[0]!.count,
    ).toBe(1);
    await expect(
      payments.settle(owner, trip.id, debt.id, {
        paidAmount: { minor: '1', currency: 'THB' },
      }),
    ).rejects.toMatchObject({ errorCode: 'AOK-8104' });
    await expect(
      expenses.update(owner, trip.id, created.id, {
        amount: { minor: '100002', currency: 'THB' },
      }),
    ).rejects.toMatchObject({ errorCode: 'AOK-5401' });
    const nextDay = await app.module
      .get(TripDaysService)
      .create(owner, trip.id, {});
    const renamed = await expenses.update(owner, trip.id, created.id, {
      name: 'ชื่อใหม่',
      dayId: nextDay.id,
    });
    expect(renamed.name).toBe('ชื่อใหม่');
    expect(renamed.dayId).toBe(nextDay.id);
    expect(renamed.obligations.map((o) => o.id).sort()).toEqual(
      created.obligations.map((o) => o.id).sort(),
    );
    await expect(
      expenses.remove(owner, trip.id, created.id),
    ).rejects.toMatchObject({ errorCode: 'AOK-5401' });
    await expect(
      app.module.get(ParticipantsService).remove(owner, trip.id, guest.id),
    ).rejects.toMatchObject({ errorCode: 'AOK-3201' });
    const cleared = await payments.clear(owner, trip.id, debt.id);
    expect(cleared.status).toBe('unpaid');
    expect(cleared.settlement).toBeNull();
    expect(await payments.clear(owner, trip.id, debt.id)).toEqual(cleared);
    const changed = await expenses.update(owner, trip.id, created.id, {
      amount: { minor: '100002', currency: 'THB' },
    });
    expect(changed.shares.map((s) => s.amount.minor)).toEqual([
      '33334',
      '33334',
      '33334',
    ]);
    expect(changed.obligations.map((o) => o.id).sort()).toEqual(
      created.obligations.map((o) => o.id).sort(),
    );
    await expenses.remove(owner, trip.id, created.id);
    await app.module.get(ParticipantsService).remove(owner, trip.id, guest.id);
    expect(
      (await app.module.get(TripsService).detail(owner, trip.id)).total.minor,
    ).toBe('0');
  });
  it('retains original JPY/settlement values while changing base currency and snapshots atomically', async () => {
    const { trip, draft, expenses, payments } = await fixture();
    const created = await expenses.create(owner, trip.id, {
      ...draft,
      amount: { minor: '1001', currency: 'JPY' },
      exchange: { manualRate: '0.23' },
    });
    expect(created.fxSnapshot?.converted).toEqual({
      minor: '23023',
      currency: 'THB',
    });
    const debt = created.obligations[0]!;
    expect(debt.amount).toEqual({ minor: '500', currency: 'JPY' });
    const preview = await payments.preview(owner, trip.id, debt.id, {
      currency: 'THB',
      exchange: { manualRate: '0.23' },
    });
    expect(preview.expectedPaidAmount).toEqual({
      minor: '11500',
      currency: 'THB',
    });
    const paidInput = {
      paidAmount: { minor: '11600', currency: 'THB' },
      exchange: { manualRate: '0.23' },
    };
    const paid = await payments.settle(owner, trip.id, debt.id, paidInput);
    expect(paid.settlement?.paidAmount.minor).toBe('11600');
    expect(
      (await payments.settle(owner, trip.id, debt.id, paidInput)).settlement
        ?.paidAt,
    ).toBe(paid.settlement?.paidAt);
    await expenses.create(owner, trip.id, {
      ...draft,
      amount: { minor: '20000', currency: 'THB' },
    });
    const lifecycle = app.module.get(TripLifecycleService);
    await expect(
      lifecycle.update(owner, trip.id, {
        baseCurrency: 'USD',
        exchangeSelections: { JPY: { manualRate: '0.0067' } },
      }),
    ).rejects.toMatchObject({ errorCode: 'AOK-2203' });
    expect(
      (await app.module.get(TripsService).detail(owner, trip.id)).baseCurrency,
    ).toBe('THB');
    const converted = await lifecycle.update(owner, trip.id, {
      baseCurrency: 'USD',
      exchangeSelections: {
        JPY: { manualRate: '0.0067' },
        THB: { manualRate: '0.03' },
      },
    });
    expect(converted.total).toEqual({ minor: '1271', currency: 'USD' });
    expect(converted.originalTotals).toEqual([
      { currency: 'JPY', minor: '1001' },
      { currency: 'THB', minor: '20000' },
    ]);
    const after = await expenses.detail(owner, trip.id, created.id);
    expect(after.amount).toEqual(created.amount);
    expect(after.obligations[0]!.settlement).toEqual(paid.settlement);
    expect(after.obligations[0]!.converted).toEqual({
      minor: '335',
      currency: 'USD',
    });
    const history = await app.pg.query<{ count: number; current: number }>(
      'SELECT count(*)::int AS count,count(*) FILTER (WHERE is_current)::int AS current FROM public.expense_exchange_rates WHERE expense_id=$1',
      [created.id],
    );
    expect(history.rows[0]).toEqual({ count: 2, current: 1 });
  });
  it('keeps opposite obligations separate and rejects foreign child ids across every write boundary', async () => {
    const { trip, guest, draft, expenses, payments } = await fixture();
    const a = await expenses.create(owner, trip.id, {
      ...draft,
      amount: { minor: '1000', currency: 'THB' },
    });
    await expenses.create(owner, trip.id, {
      ...draft,
      payerParticipantId: guest.id,
      participantIds: [draft.payerParticipantId],
      amount: { minor: '1000', currency: 'THB' },
    });
    const summary = await app.module.get(SummaryService).detail(owner, trip.id);
    expect(summary.obligations).toHaveLength(2);
    expect(summary.obligations.map((o) => o.amount.minor)).toEqual([
      '500',
      '500',
    ]);
    expect(
      new Set(summary.obligations.map((o) => o.creditorParticipantId)).size,
    ).toBe(2);
    const other = await app.user('other');
    const foreign = await app.module
      .get(TripsService)
      .create(other, { name: 'private', baseCurrency: 'THB' });
    await expect(
      expenses.create(owner, trip.id, { ...draft, dayId: foreign.days[0]!.id }),
    ).rejects.toMatchObject({ errorCode: 'AOK-4001' });
    await expect(
      expenses.create(owner, trip.id, {
        ...draft,
        payerParticipantId: foreign.participants[0]!.id,
      }),
    ).rejects.toMatchObject({ errorCode: 'AOK-5302' });
    await expect(
      expenses.create(owner, trip.id, {
        ...draft,
        participantIds: [foreign.participants[0]!.id],
      }),
    ).rejects.toMatchObject({ errorCode: 'AOK-6001' });
    await expect(expenses.detail(other, trip.id, a.id)).rejects.toMatchObject({
      errorCode: 'AOK-2001',
    });
    await expect(
      expenses.detail(other, foreign.id, a.id),
    ).rejects.toMatchObject({ errorCode: 'AOK-5001' });
    await expect(
      payments.clear(other, foreign.id, a.obligations[0]!.id),
    ).rejects.toMatchObject({ errorCode: 'AOK-8001' });
    await expect(
      app.module
        .get(ParticipantsService)
        .update(owner, trip.id, foreign.participants[0]!.id, {
          displayName: 'hack',
        }),
    ).rejects.toMatchObject({ errorCode: 'AOK-3001' });
    await expect(
      app.module
        .get(TripDaysService)
        .update(owner, trip.id, foreign.days[0]!.id, { name: 'hack' }),
    ).rejects.toMatchObject({ errorCode: 'AOK-4001' });
  });
  it('rolls back Expense + shares + obligations if the last FX write fails', async () => {
    const { trip, draft, expenses } = await fixture();
    await app.pg.exec(
      `CREATE FUNCTION public.test_fail_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only failure'; END; $$; CREATE TRIGGER test_fail_snapshot BEFORE INSERT ON public.expense_exchange_rates FOR EACH ROW EXECUTE FUNCTION public.test_fail_snapshot();`,
    );
    try {
      await expect(
        expenses.create(owner, trip.id, {
          ...draft,
          amount: { minor: '1001', currency: 'JPY' },
          exchange: { manualRate: '0.23' },
        }),
      ).rejects.toThrow();
      for (const table of [
        'expenses',
        'expense_shares',
        'obligations',
        'expense_exchange_rates',
      ]) {
        const count = await app.pg.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM public.${table}`,
        );
        expect(count.rows[0]!.count).toBe(0);
      }
    } finally {
      await app.pg.exec(
        'DROP TRIGGER test_fail_snapshot ON public.expense_exchange_rates;DROP FUNCTION public.test_fail_snapshot();',
      );
    }
  });
  it('uses verified quotes, preserves provider snapshots on amount-only updates and allows manual entry during an outage', async () => {
    const { trip, draft, expenses } = await fixture();
    const quotes = app.module.get(ExchangeRatesService);
    const quote = await quotes.quote(owner, 'JPY', 'THB');
    const created = await expenses.create(owner, trip.id, {
      ...draft,
      amount: { minor: '1001', currency: 'JPY' },
      exchange: { quoteId: quote.quoteId },
    });
    expect(created.fxSnapshot?.source).toBe('provider');
    const updated = await expenses.update(owner, trip.id, created.id, {
      amount: { minor: '2001', currency: 'JPY' },
    });
    expect(updated.fxSnapshot?.converted.minor).toBe('46023');
    expect(updated.fxSnapshot?.capturedAt).toBe(created.fxSnapshot?.capturedAt);
    expect(updated.fxSnapshot?.source).toBe('provider');
    app.invoke.mockRejectedValueOnce(new Error('upstream-private'));
    await expect(quotes.quote(owner, 'JPY', 'THB')).rejects.toMatchObject({
      errorCode: 'AOK-7003',
    });
    expect(
      (
        await expenses.create(owner, trip.id, {
          ...draft,
          amount: { minor: '10', currency: 'JPY' },
          exchange: { manualRate: '0.23' },
        })
      ).fxSnapshot?.source,
    ).toBe('manual');
    const other = await app.user('other');
    await expect(
      expenses.create(owner, trip.id, {
        ...draft,
        amount: { minor: '1001', currency: 'JPY' },
        exchange: {
          quoteId: (await quotes.quote(other, 'JPY', 'THB')).quoteId,
        },
      }),
    ).rejects.toMatchObject({ errorCode: 'AOK-7007' });
  });
});
