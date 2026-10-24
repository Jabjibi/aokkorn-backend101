import { Inject, Injectable } from '@nestjs/common';
import { sumMoney } from '../../common/money.js';
import { TripAccessService } from '../trips/trip-access.service.js';
import { TripsRepository } from '../trips/trips.repository.js';
import { ExpenseReadRepository } from '../expenses/expense-read.repository.js';

/** I/O read-only: actor/trip → summary ใน snapshot เดียว; ไม่ net ยอดสวนทาง */
@Injectable()
export class SummaryService {
  constructor(
    @Inject(TripAccessService) private readonly access: TripAccessService,
    @Inject(TripsRepository) private readonly trips: TripsRepository,
    @Inject(ExpenseReadRepository)
    private readonly expenses: ExpenseReadRepository,
  ) {}

  detail(ownerId: string, tripId: string) {
    return this.access.run(ownerId, tripId, false, async (client, trip) => {
      const detail = await this.trips.readDetail(client, ownerId, tripId);
      const expenses = await this.expenses.list(
        client,
        tripId,
        trip.base_currency_code,
      );
      const obligations = expenses.flatMap((e) =>
        e.obligations.map((o) => ({
          ...o,
          expenseName: e.name,
          dayId: e.dayId,
        })),
      );
      return {
        trip: detail,
        total: detail.total,
        originalTotals: detail.originalTotals,
        days: detail.days,
        expenses,
        obligations,
        obligationTotals: {
          paid: sumMoney(
            obligations.filter((o) => o.status === 'paid').map((o) => o.amount),
          ),
          unpaid: sumMoney(
            obligations
              .filter((o) => o.status === 'unpaid')
              .map((o) => o.amount),
          ),
        },
      };
    });
  }
}
