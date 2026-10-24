import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service.js';
import { ApiError, ERRORS } from '../../common/api-error.filter.js';

export type LifecycleTrip = {
  id: string;
  name: string;
  base_currency_code: string;
  deleted_at: Date | null;
  restore_until: Date | null;
  restorable: boolean;
};

@Injectable()
export class TripLifecycleRepository {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** I/O: owner → deleted trips ที่ยังไม่พ้น 30 วัน; ไม่เปิดข้อมูลเจ้าของอื่น */
  async deleted(ownerId: string) {
    const result = await this.db.query<{
      id: string;
      name: string;
      base_currency_code: string;
      deleted_at: Date;
      restore_until: Date;
    }>(
      `SELECT id,name,base_currency_code,deleted_at,deleted_at+interval '30 days' AS restore_until FROM public.trips WHERE owner_user_id=$1 AND deleted_at IS NOT NULL AND deleted_at+interval '30 days'>clock_timestamp() ORDER BY deleted_at DESC,id DESC`,
      [ownerId],
    );
    return {
      items: result.rows.map((t) => ({
        id: t.id,
        name: t.name,
        baseCurrency: t.base_currency_code,
        deletedAt: t.deleted_at.toISOString(),
        restoreUntil: t.restore_until.toISOString(),
      })),
    };
  }

  /** I/O: lock owner ก่อน trip เสมอ; protocol เดียวกับ create เพื่อบังคับโควตา create/restore พร้อมกัน */
  run<T>(
    ownerId: string,
    tripId: string,
    work: (client: PoolClient, trip: LifecycleTrip) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (client) => {
      const user = await client.query(
        'SELECT id FROM public.users WHERE id=$1 FOR UPDATE',
        [ownerId],
      );
      if (!user.rows.length)
        throw new ApiError(ERRORS.SESSION_MISSING, 'กรุณาเข้าสู่ระบบ');
      const trip = await client.query<LifecycleTrip>(
        `SELECT id,name,base_currency_code,deleted_at,deleted_at+interval '30 days' AS restore_until,(deleted_at+interval '30 days'>clock_timestamp()) AS restorable FROM public.trips WHERE id=$1 AND owner_user_id=$2 FOR UPDATE`,
        [tripId, ownerId],
      );
      if (!trip.rows[0])
        throw new ApiError(ERRORS.TRIP_NOT_FOUND, 'ไม่พบทริปนี้');
      return work(client, trip.rows[0]);
    });
  }

  async activeCount(client: PoolClient, ownerId: string): Promise<number> {
    const result = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM public.trips WHERE owner_user_id=$1 AND deleted_at IS NULL',
      [ownerId],
    );
    return result.rows[0]!.count;
  }

  async remove(client: PoolClient, id: string) {
    const result = await client.query<{
      deleted_at: Date;
      restore_until: Date;
    }>(
      `UPDATE public.trips SET deleted_at=clock_timestamp() WHERE id=$1 RETURNING deleted_at,deleted_at+interval '30 days' AS restore_until`,
      [id],
    );
    return {
      id,
      deletedAt: result.rows[0]!.deleted_at.toISOString(),
      restoreUntil: result.rows[0]!.restore_until.toISOString(),
    };
  }

  async restore(client: PoolClient, id: string): Promise<void> {
    await client.query('UPDATE public.trips SET deleted_at=NULL WHERE id=$1', [
      id,
    ]);
  }

  async update(
    client: PoolClient,
    id: string,
    name: string,
    currency: string,
  ): Promise<void> {
    await client.query(
      'UPDATE public.trips SET name=$2,base_currency_code=$3 WHERE id=$1',
      [id, name, currency],
    );
  }

  async expenseAmounts(client: PoolClient, tripId: string) {
    return (
      await client.query<{
        id: string;
        amount_minor: string;
        currency_code: string;
      }>(
        'SELECT id,amount_minor::text,currency_code FROM public.expenses WHERE trip_id=$1 ORDER BY id',
        [tripId],
      )
    ).rows;
  }
}
