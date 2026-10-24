import { Inject, Injectable } from '@nestjs/common';
import { ApiError, ERRORS } from '../../common/api-error.filter.js';
import { convertMinor, rateInput } from '../../common/money.js';
import { TripAccessService } from '../trips/trip-access.service.js';
import { CurrenciesService } from '../currencies/currencies.service.js';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service.js';
import type {
  ExchangeSelection,
  FxSnapshot,
} from '../exchange-rates/exchange.dto.js';
import { ExpenseReadRepository } from '../expenses/expense-read.repository.js';
import { ObligationsRepository } from './obligations.repository.js';
import type { SettlementInput } from './obligations.dto.js';

@Injectable()
export class ObligationsService {
  constructor(
    @Inject(TripAccessService) private readonly access: TripAccessService,
    @Inject(CurrenciesService) private readonly currencies: CurrenciesService,
    @Inject(ExchangeRatesService) private readonly fx: ExchangeRatesService,
    @Inject(ExpenseReadRepository)
    private readonly reader: ExpenseReadRepository,
    @Inject(ObligationsRepository)
    private readonly repository: ObligationsRepository,
  ) {}

  /** I/O read-only: actor/id/currency → expected paid amount; ไม่แก้สถานะ */
  preview(
    ownerId: string,
    tripId: string,
    id: string,
    input: { currency: string; exchange?: ExchangeSelection },
  ) {
    return this.access.run(ownerId, tripId, false, async (client, trip) => {
      const obligation = await this.reader.obligation(
        client,
        tripId,
        trip.base_currency_code,
        id,
      );
      const from = await this.currencies.require(
        obligation.amount.currency,
        ERRORS.SETTLEMENT_CURRENCY_UNSUPPORTED,
        client,
      );
      const to = await this.currencies.require(
        input.currency,
        ERRORS.SETTLEMENT_CURRENCY_UNSUPPORTED,
        client,
      );
      if (from.code !== to.code && !input.exchange)
        throw new ApiError(
          ERRORS.SETTLEMENT_EXCHANGE_RATE_REQUIRED,
          'กรุณาระบุอัตราสำหรับสกุลเงินที่จ่าย',
        );
      const snapshot = this.fx.snapshot(
        obligation.amount,
        from,
        to,
        input.exchange,
        ownerId,
      );
      return {
        obligationId: id,
        originalAmount: obligation.amount,
        expectedPaidAmount: snapshot?.converted ?? obligation.amount,
        fxSnapshot: snapshot,
      };
    });
  }

  /** I/O atomic: paidAmount จริง + selection → paid obligation; คำขอเดิมซ้ำเป็น no-op */
  settle(ownerId: string, tripId: string, id: string, input: SettlementInput) {
    return this.access.run(ownerId, tripId, true, async (client, trip) => {
      const obligation = await this.reader.obligation(
        client,
        tripId,
        trip.base_currency_code,
        id,
      );
      const from = await this.currencies.require(
        obligation.amount.currency,
        ERRORS.SETTLEMENT_CURRENCY_UNSUPPORTED,
        client,
      );
      const to = await this.currencies.require(
        input.paidAmount.currency,
        ERRORS.SETTLEMENT_CURRENCY_UNSUPPORTED,
        client,
      );
      const previous = obligation.settlement;
      if (
        previous &&
        (previous.paidAmount.minor !== input.paidAmount.minor ||
          previous.paidAmount.currency !== input.paidAmount.currency)
      )
        throw new ApiError(
          ERRORS.SETTLEMENT_ALREADY_PAID_DIFFERENT,
          'ยอดนี้จ่ายแล้ว กรุณาย้อนสถานะก่อนเปลี่ยนข้อมูล',
        );
      if (from.code !== to.code && !input.exchange)
        throw new ApiError(
          ERRORS.SETTLEMENT_EXCHANGE_RATE_REQUIRED,
          'กรุณาระบุอัตราสำหรับสกุลเงินที่จ่าย',
        );
      let snapshot: FxSnapshot | null = null;
      if (from.code !== to.code) {
        // คำขอเดิมที่ส่งซ้ำยัง no-op แม้ quote หมดอายุ; signature/actor/pair ยังต้องผ่าน
        const rate = this.fx.resolveRate(
          input.exchange,
          ownerId,
          from.code,
          to.code,
          Boolean(previous),
        );
        snapshot = {
          fromCurrency: from.code,
          toCurrency: to.code,
          ...rate,
          converted: {
            minor: convertMinor(
              obligation.amount.minor,
              rate.rate,
              from.minorUnitDigits,
              to.minorUnitDigits,
            ),
            currency: to.code,
          },
        };
      } else if (input.exchange)
        throw new ApiError(
          ERRORS.EXCHANGE_RATE_QUOTE_MISMATCH,
          'ไม่ต้องใช้อัตราสำหรับสกุลเดียวกัน',
        );
      if (previous) {
        const saved = previous.fxSnapshot;
        const same =
          (!saved && !snapshot) ||
          (saved &&
            snapshot &&
            rateInput(saved.rate) === snapshot.rate &&
            saved.source === snapshot.source &&
            (saved.source === 'manual' ||
              saved.capturedAt === snapshot.capturedAt));
        if (!same)
          throw new ApiError(
            ERRORS.SETTLEMENT_ALREADY_PAID_DIFFERENT,
            'ข้อมูลการจ่ายไม่ตรงกับที่บันทึก',
          );
        return obligation;
      }
      await this.repository.settle(client, id, input.paidAmount, snapshot);
      return this.reader.obligation(
        client,
        tripId,
        trip.base_currency_code,
        id,
      );
    });
  }

  /** I/O atomic: paid → unpaid + ลบ settlement; unpaid เดิมเป็น idempotent no-op */
  clear(ownerId: string, tripId: string, id: string) {
    return this.access.run(ownerId, tripId, true, async (client, trip) => {
      const value = await this.reader.obligation(
        client,
        tripId,
        trip.base_currency_code,
        id,
      );
      if (value.status === 'unpaid') return value;
      await this.repository.clear(client, id);
      return this.reader.obligation(
        client,
        tripId,
        trip.base_currency_code,
        id,
      );
    });
  }
}
