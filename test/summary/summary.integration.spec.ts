import { testBackend } from '../support/test-backend.js';
import { TripsService } from '../../src/api/trips/trips.service.js';
import { ParticipantsService } from '../../src/api/participants/participants.service.js';
import { ExpensesService } from '../../src/api/expenses/expenses.service.js';
import { SummaryService } from '../../src/api/summary/summary.service.js';

describe('summary keeps original currencies, daily totals and opposite debts', () => {
  let app: Awaited<ReturnType<typeof testBackend>>;
  beforeAll(async () => {
    app = await testBackend();
  }, 30000);
  afterAll(async () => {
    await app?.close();
  });
  it('returns source money and base-currency totals without netting directions', async () => {
    const owner = await app.user();
    const trip = await app.module
      .get(TripsService)
      .create(owner, { name: 'summary', baseCurrency: 'THB' });
    const guest = await app.module
      .get(ParticipantsService)
      .create(owner, trip.id, { displayName: 'guest' });
    const expenses = app.module.get(ExpensesService),
      payer = trip.participants[0]!.id;
    const first = {
      dayId: trip.days[0]!.id,
      name: 'JPY',
      amount: { minor: '1001', currency: 'JPY' },
      payerParticipantId: payer,
      participantIds: [guest.id],
      exchange: { manualRate: '0.23' },
    };
    const preview = await expenses.preview(owner, trip.id, first);
    expect(preview.shares.map((s) => s.converted.minor)).toEqual([
      '11523',
      '11500',
    ]);
    const jpy = await expenses.create(owner, trip.id, first);
    expect(jpy.shares[1]!.converted).toEqual({
      minor: '11500',
      currency: 'THB',
    });
    await expenses.create(owner, trip.id, {
      dayId: trip.days[0]!.id,
      name: 'THB',
      amount: { minor: '1000', currency: 'THB' },
      payerParticipantId: guest.id,
      participantIds: [payer],
    });
    const result = await app.module.get(SummaryService).detail(owner, trip.id);
    expect(result.total).toEqual({ minor: '24023', currency: 'THB' });
    expect(result.days[0]!.total).toEqual(result.total);
    expect(result.originalTotals).toEqual([
      { currency: 'JPY', minor: '1001' },
      { currency: 'THB', minor: '1000' },
    ]);
    expect(result.obligations).toHaveLength(2);
    expect(result.obligationTotals.unpaid).toEqual([
      { currency: 'JPY', minor: '500' },
      { currency: 'THB', minor: '500' },
    ]);
    expect(result.obligations.map((o) => o.expenseName).sort()).toEqual([
      'JPY',
      'THB',
    ]);
  });
});
