import { testBackend } from '../support/test-backend.js';
import { TripsService } from '../../src/api/trips/trips.service.js';
import { ParticipantsService } from '../../src/api/participants/participants.service.js';
import { ExpensesService } from '../../src/api/expenses/expenses.service.js';
import { ObligationsService } from '../../src/api/obligations/obligations.service.js';

describe('settlement transaction failure and zero-share obligations', () => {
  let app: Awaited<ReturnType<typeof testBackend>>;
  beforeAll(async () => {
    app = await testBackend();
  }, 30000);
  beforeEach(() => app.reset());
  afterAll(async () => {
    await app?.close();
  });
  async function fixture(minor = '1000') {
    const owner = await app.user();
    const trip = await app.module
      .get(TripsService)
      .create(owner, { name: 'pay', baseCurrency: 'THB' });
    const guest = await app.module
      .get(ParticipantsService)
      .create(owner, trip.id, { displayName: 'guest' });
    const expense = await app.module
      .get(ExpensesService)
      .create(owner, trip.id, {
        dayId: trip.days[0]!.id,
        name: 'food',
        amount: { minor, currency: 'THB' },
        payerParticipantId: trip.participants[0]!.id,
        participantIds: [guest.id],
      });
    return {
      owner,
      trip,
      expense,
      payments: app.module.get(ObligationsService),
    };
  }
  it('does not create zero-value obligations for shares below one minor unit', async () => {
    const { expense } = await fixture('1');
    expect(expense.shares.map((s) => s.amount.minor)).toEqual(['1', '0']);
    expect(expense.obligations).toEqual([]);
  });
  it('rolls back settlement and status together after the last write fails', async () => {
    const { owner, trip, expense, payments } = await fixture();
    const debt = expense.obligations[0]!;
    await app.pg.exec(
      `CREATE FUNCTION public.test_fail_paid() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='paid' THEN RAISE EXCEPTION 'test-only failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER test_fail_paid BEFORE UPDATE ON public.obligations FOR EACH ROW EXECUTE FUNCTION public.test_fail_paid();`,
    );
    try {
      await expect(
        payments.settle(owner, trip.id, debt.id, { paidAmount: debt.amount }),
      ).rejects.toThrow();
      expect(
        (
          await app.pg.query<{ count: number }>(
            'SELECT count(*)::int AS count FROM public.obligation_settlements',
          )
        ).rows[0]!.count,
      ).toBe(0);
      const state = await app.module
        .get(ExpensesService)
        .detail(owner, trip.id, expense.id);
      expect(state.obligations[0]!.status).toBe('unpaid');
    } finally {
      await app.pg.exec(
        'DROP TRIGGER test_fail_paid ON public.obligations;DROP FUNCTION public.test_fail_paid();',
      );
    }
  });
});
