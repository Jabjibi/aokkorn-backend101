import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ApiError, ERRORS } from '../../common/api-error.filter.js';
import { convertMinor, sumMoney } from '../../common/money.js';
import {
  TripAccessService,
  type OwnedTrip,
} from '../trips/trip-access.service.js';
import { CurrenciesService } from '../currencies/currencies.service.js';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service.js';
import { ExpenseSnapshotRepository } from '../exchange-rates/expense-snapshot.repository.js';
import { ExpensesRepository } from './expenses.repository.js';
import {
  ExpenseReadRepository,
  type ExpenseView,
} from './expense-read.repository.js';
import { parseExpenseText, splitExpense } from './expense-calculations.js';
import type { ExpenseInput, ExpensePatch } from './expenses.dto.js';

/** Use cases รับ typed DTO; pure calculations แยกไฟล์, SQL อยู่ repositories */
@Injectable()
export class ExpensesService {
  constructor(
    @Inject(TripAccessService) private readonly access: TripAccessService,
    @Inject(CurrenciesService) private readonly currencies: CurrenciesService,
    @Inject(ExchangeRatesService) private readonly fx: ExchangeRatesService,
    @Inject(ExpenseSnapshotRepository)
    private readonly snapshots: ExpenseSnapshotRepository,
    @Inject(ExpensesRepository) private readonly repository: ExpensesRepository,
    @Inject(ExpenseReadRepository)
    private readonly reader: ExpenseReadRepository,
  ) {}

  /** I/O read-only: text/currency → draft; ไม่มีการบันทึก */
  parse(
    ownerId: string,
    tripId: string,
    input: { text: string; currency: string },
  ) {
    return this.access.run(ownerId, tripId, false, async (client) => {
      const currency = await this.currencies.require(
        input.currency,
        ERRORS.EXPENSE_CURRENCY_UNSUPPORTED,
        client,
      );
      return parseExpenseText(
        input.text,
        currency.code,
        currency.minorUnitDigits,
      );
    });
  }

  /** I/O read-only: draft → shares/obligations/FX preview; ไม่ออก ID ปลอมและไม่เขียนข้อมูล */
  preview(ownerId: string, tripId: string, input: ExpenseInput) {
    return this.access.run(ownerId, tripId, false, async (client, trip) => {
      const plan = await this.plan(client, trip, ownerId, input);
      return {
        ...input,
        exchange: undefined,
        shares: plan.shares,
        obligations: plan.shares
          .filter(
            (s) =>
              s.participantId !== input.payerParticipantId &&
              BigInt(s.amount.minor) > 0n,
          )
          .map((s) => ({
            debtorParticipantId: s.participantId,
            creditorParticipantId: input.payerParticipantId,
            amount: s.amount,
            converted: s.converted,
            status: 'unpaid' as const,
          })),
        fxSnapshot: plan.fx,
      };
    });
  }

  /** I/O atomic: Expense + shares + obligations + FX ทั้งชุด; ไม่เรียก provider ระหว่าง transaction */
  create(ownerId: string, tripId: string, input: ExpenseInput) {
    return this.access.run(ownerId, tripId, true, async (client, trip) => {
      const plan = await this.plan(client, trip, ownerId, input);
      const id = await this.repository.create(client, tripId, input);
      await this.repository.replaceSplit(
        client,
        id,
        input.payerParticipantId,
        plan.shares,
      );
      await this.snapshots.replace(client, id, plan.fx);
      return this.reader.require(client, tripId, trip.base_currency_code, id);
    });
  }

  /** I/O read-only: actor/trip/expense → ExpenseView หรือ 404 */
  detail(ownerId: string, tripId: string, id: string) {
    return this.access.run(ownerId, tripId, false, (client, trip) =>
      this.reader.require(client, tripId, trip.base_currency_code, id),
    );
  }

  /** I/O read-only: actor/trip/day → รายการพร้อมยอดรายวันและต้นทางแยกสกุล */
  listDay(ownerId: string, tripId: string, dayId: string) {
    return this.access.run(ownerId, tripId, false, async (client, trip) => {
      await this.repository.requireDay(client, tripId, dayId);
      const items = await this.reader.list(
        client,
        tripId,
        trip.base_currency_code,
        undefined,
        dayId,
      );
      const total = sumMoney(
        items.map((e) => e.fxSnapshot?.converted ?? e.amount),
      )[0] ?? { minor: '0', currency: trip.base_currency_code };
      return {
        items,
        total,
        originalTotals: sumMoney(items.map((e) => e.amount)),
      };
    });
  }

  /** I/O atomic: paid obligation ล็อกการเปลี่ยนกฎเงิน แต่แก้ชื่อ/ย้ายวันได้ */
  update(ownerId: string, tripId: string, id: string, patch: ExpensePatch) {
    return this.access.run(ownerId, tripId, true, async (client, trip) => {
      const previous = await this.reader.require(
        client,
        tripId,
        trip.base_currency_code,
        id,
      );
      const next: ExpenseInput = {
        dayId: previous.dayId,
        name: previous.name,
        amount: previous.amount,
        payerParticipantId: previous.payerParticipantId,
        participantIds: previous.participantIds,
        ...patch,
      };
      const samePeople =
        [...new Set([next.payerParticipantId, ...next.participantIds])]
          .sort()
          .join(',') === [...previous.participantIds].sort().join(',');
      const financial =
        next.amount.minor !== previous.amount.minor ||
        next.amount.currency !== previous.amount.currency ||
        next.payerParticipantId !== previous.payerParticipantId ||
        !samePeople ||
        patch.exchange !== undefined;
      if (financial) this.assertUnpaid(previous);
      await this.repository.requireDay(client, tripId, next.dayId);
      if (financial) {
        const plan = await this.plan(client, trip, ownerId, next, previous);
        await this.repository.update(client, id, next);
        await this.repository.replaceSplit(
          client,
          id,
          next.payerParticipantId,
          plan.shares,
        );
        await this.snapshots.replace(client, id, plan.fx);
      } else await this.repository.update(client, id, next);
      return this.reader.require(client, tripId, trip.base_currency_code, id);
    });
  }

  remove(ownerId: string, tripId: string, id: string) {
    return this.access.run(ownerId, tripId, true, async (client, trip) => {
      this.assertUnpaid(
        await this.reader.require(client, tripId, trip.base_currency_code, id),
      );
      await this.repository.remove(client, id);
      return { id, deleted: true };
    });
  }

  private assertUnpaid(expense: ExpenseView): void {
    if (expense.obligations.some((o) => o.status === 'paid'))
      throw new ApiError(
        ERRORS.EXPENSE_PAID_OBLIGATION_LOCKED,
        'กรุณาย้อนสถานะจ่ายแล้วก่อนแก้ยอดหรือคนหาร',
      );
  }

  /** I/O validation + pure plan; currency/day/payer/selected ตรวจภายใต้ snapshot/lock เดียวกัน */
  private async plan(
    client: PoolClient,
    trip: OwnedTrip,
    ownerId: string,
    input: ExpenseInput,
    previous?: ExpenseView,
  ) {
    await this.repository.requireDay(client, trip.id, input.dayId);
    const source = await this.currencies.require(
      input.amount.currency,
      ERRORS.EXPENSE_CURRENCY_UNSUPPORTED,
      client,
    );
    const target = await this.currencies.require(
      trip.base_currency_code,
      ERRORS.TRIP_BASE_CURRENCY_UNSUPPORTED,
      client,
    );
    const shares = splitExpense(
      input.amount,
      input.payerParticipantId,
      input.participantIds,
      await this.repository.people(client, trip.id),
    );
    const saved = previous?.fxSnapshot;
    const reuse =
      saved &&
      !input.exchange &&
      saved.fromCurrency === source.code &&
      saved.toCurrency === target.code;
    const fx = reuse
      ? {
          ...saved,
          converted: {
            minor: convertMinor(
              input.amount.minor,
              saved.rate,
              source.minorUnitDigits,
              target.minorUnitDigits,
            ),
            currency: target.code,
          },
        }
      : this.fx.snapshot(input.amount, source, target, input.exchange, ownerId);
    return {
      shares: shares.map((share) => ({
        ...share,
        converted: fx
          ? {
              minor: convertMinor(
                share.amount.minor,
                fx.rate,
                source.minorUnitDigits,
                target.minorUnitDigits,
              ),
              currency: target.code,
            }
          : share.amount,
      })),
      fx,
    };
  }
}
