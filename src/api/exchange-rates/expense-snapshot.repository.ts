import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { FxSnapshot } from './exchange.dto.js';

/** I/O: ใช้ transaction ของ caller; เก็บประวัติอัตราและเปลี่ยน current แบบ atomic */
@Injectable()
export class ExpenseSnapshotRepository {
  async replace(
    client: PoolClient,
    expenseId: string,
    snapshot: FxSnapshot | null,
  ): Promise<void> {
    await client.query(
      'UPDATE public.expense_exchange_rates SET is_current=false WHERE expense_id=$1 AND is_current',
      [expenseId],
    );
    if (snapshot)
      await client.query(
        `INSERT INTO public.expense_exchange_rates(expense_id,from_currency,to_currency,rate,source,captured_at,converted_amount_minor) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          expenseId,
          snapshot.fromCurrency,
          snapshot.toCurrency,
          snapshot.rate,
          snapshot.source,
          snapshot.capturedAt,
          snapshot.converted.minor,
        ],
      );
  }
}
