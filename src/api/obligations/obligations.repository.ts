import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { Money } from '../../common/money.js';
import type { FxSnapshot } from '../exchange-rates/exchange.dto.js';

/** I/O: caller ตรวจ owner และ lock trip; status/settlement เปลี่ยนใน transaction เดียว */
@Injectable()
export class ObligationsRepository {
  async settle(
    client: PoolClient,
    id: string,
    paid: Money,
    fx: FxSnapshot | null,
  ): Promise<void> {
    await client.query(
      `INSERT INTO public.obligation_settlements(obligation_id,paid_currency,paid_amount_minor,paid_at,fx_rate,fx_source,fx_captured_at,expected_paid_amount_minor) VALUES($1,$2,$3,clock_timestamp(),$4,$5,$6,$7)`,
      [
        id,
        paid.currency,
        paid.minor,
        fx?.rate ?? null,
        fx?.source ?? null,
        fx?.capturedAt ?? null,
        fx?.converted.minor ?? null,
      ],
    );
    await client.query(
      "UPDATE public.obligations SET status='paid' WHERE id=$1",
      [id],
    );
  }

  async clear(client: PoolClient, id: string): Promise<void> {
    await client.query(
      'DELETE FROM public.obligation_settlements WHERE obligation_id=$1',
      [id],
    );
    await client.query(
      "UPDATE public.obligations SET status='unpaid' WHERE id=$1",
      [id],
    );
  }
}
