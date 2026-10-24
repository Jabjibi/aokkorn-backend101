import { Inject, Injectable } from '@nestjs/common';
import { ApiError, ERRORS } from '../../common/api-error.filter.js';
import { TripAccessService } from './trip-access.service.js';
import { TripLifecycleRepository } from './trip-lifecycle.repository.js';
import { TripsRepository } from './trips.repository.js';
import { TRIP_LIMIT } from './trips.dto.js';
import { CurrenciesService } from '../currencies/currencies.service.js';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service.js';
import { ExpenseSnapshotRepository } from '../exchange-rates/expense-snapshot.repository.js';
import type { UpdateTrip } from './trip-lifecycle.dto.js';

@Injectable()
export class TripLifecycleService {
  constructor(
    @Inject(TripLifecycleRepository)
    private readonly repository: TripLifecycleRepository,
    @Inject(TripsRepository) private readonly trips: TripsRepository,
    @Inject(TripAccessService) private readonly access: TripAccessService,
    @Inject(CurrenciesService) private readonly currencies: CurrenciesService,
    @Inject(ExchangeRatesService) private readonly fx: ExchangeRatesService,
    @Inject(ExpenseSnapshotRepository)
    private readonly snapshots: ExpenseSnapshotRepository,
  ) {}

  deleted(ownerId: string) {
    return this.repository.deleted(ownerId);
  }

  /** I/O: actor/id → deletedAt/restoreUntil; ไม่ลบข้อมูลลูกเพื่อให้กู้คืนได้ */
  remove(ownerId: string, id: string) {
    return this.repository.run(ownerId, id, async (client, trip) => {
      if (trip.deleted_at)
        throw new ApiError(ERRORS.TRIP_ALREADY_DELETED, 'ทริปนี้ถูกลบแล้ว');
      return this.repository.remove(client, id);
    });
  }

  /** I/O: restore ภายใน 30 วันและโควตาไม่เต็ม; owner lock กันแข่งกับ create */
  restore(ownerId: string, id: string) {
    return this.repository.run(ownerId, id, async (client, trip) => {
      if (!trip.deleted_at)
        throw new ApiError(ERRORS.TRIP_NOT_FOUND, 'ไม่พบทริปที่ลบ');
      if (!trip.restorable)
        throw new ApiError(
          ERRORS.TRIP_RESTORE_WINDOW_EXPIRED,
          'พ้นช่วงกู้คืนทริปแล้ว',
        );
      if ((await this.repository.activeCount(client, ownerId)) >= TRIP_LIMIT)
        throw new ApiError(
          ERRORS.TRIP_RESTORE_LIMIT_EXCEEDED,
          'โควตาทริปเต็มแล้ว',
        );
      await this.repository.restore(client, id);
      return this.trips.readDetail(client, ownerId, id);
    });
  }

  /** I/O: PATCH → TripDetail; เปลี่ยน base currency ต้องทำ snapshots ทุก expense ใน transaction เดียว */
  update(ownerId: string, id: string, input: UpdateTrip) {
    return this.access.run(ownerId, id, true, async (client, trip) => {
      const previous = await this.trips.readDetail(client, ownerId, id);
      const target = input.baseCurrency ?? trip.base_currency_code;
      const currency = await this.currencies.require(
        target,
        ERRORS.TRIP_BASE_CURRENCY_UNSUPPORTED,
        client,
      );
      if (target !== trip.base_currency_code) {
        const expenses = await this.repository.expenseAmounts(client, id);
        const needed = new Set(
          expenses
            .filter((e) => e.currency_code !== target)
            .map((e) => e.currency_code),
        );
        if ([...needed].some((code) => !input.exchangeSelections?.[code]))
          throw new ApiError(
            ERRORS.TRIP_BASE_CURRENCY_RATE_REQUIRED,
            'กรุณาระบุอัตราสำหรับทุกสกุลเงินต้นทาง',
          );
        if (
          Object.keys(input.exchangeSelections ?? {}).some(
            (code) => !needed.has(code),
          )
        )
          throw new ApiError(
            ERRORS.VALIDATION_FAILED,
            'ส่งอัตราสกุลเงินที่ไม่ใช้ในทริป',
          );
        const sources = new Map<
          string,
          Awaited<ReturnType<CurrenciesService['require']>>
        >();
        for (const code of new Set(expenses.map((e) => e.currency_code)))
          sources.set(
            code,
            await this.currencies.require(
              code,
              ERRORS.TRIP_BASE_CURRENCY_UNSUPPORTED,
              client,
            ),
          );
        for (const expense of expenses) {
          const source = sources.get(expense.currency_code)!;
          try {
            const snapshot = this.fx.snapshot(
              { minor: expense.amount_minor, currency: source.code },
              source,
              currency,
              input.exchangeSelections?.[source.code],
              ownerId,
            );
            await this.snapshots.replace(client, expense.id, snapshot);
          } catch (error) {
            if (
              error instanceof ApiError &&
              error.errorCode === ERRORS.EXCHANGE_RATE_INVALID[1]
            )
              throw new ApiError(
                ERRORS.TRIP_BASE_CURRENCY_CONVERSION_INVALID,
                'ไม่สามารถแปลงยอดทริปได้',
              );
            throw error;
          }
        }
      } else if (input.exchangeSelections)
        throw new ApiError(
          ERRORS.VALIDATION_FAILED,
          'ไม่ได้เปลี่ยนสกุลเงินหลัก',
        );
      await this.repository.update(
        client,
        id,
        input.name ?? previous.name,
        target,
      );
      return this.trips.readDetail(client, ownerId, id);
    });
  }
}
