import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ApiError, ERRORS } from '../../common/api-error.filter.js';

type Day = {
  id: string;
  name: string;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
};

function view(d: Day) {
  return {
    id: d.id,
    name: d.name,
    sortOrder: d.sort_order,
    createdAt: d.created_at.toISOString(),
    updatedAt: d.updated_at.toISOString(),
  };
}

@Injectable()
export class TripDaysRepository {
  /** I/O: caller lock trip แล้ว; MAX+1 ปลอดภัยระหว่างคำขอของแอปเดียวกัน */
  async create(client: PoolClient, tripId: string, name?: string) {
    try {
      const result = await client.query<Day>(
        `INSERT INTO public.trip_days(trip_id,name,sort_order) SELECT $1,coalesce($2,'วัน '||(coalesce(max(sort_order),0)+1)::text),coalesce(max(sort_order),0)+1 FROM public.trip_days WHERE trip_id=$1 RETURNING *`,
        [tripId, name ?? null],
      );
      return view(result.rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ApiError(
          ERRORS.TRIP_DAY_ORDER_CONFLICT,
          'ลำดับวันซ้ำ กรุณาลองใหม่',
        );
      throw error;
    }
  }

  /** I/O: client/trip/day/name → day ที่แก้แล้ว หรือ 404 */
  async update(client: PoolClient, tripId: string, id: string, name: string) {
    const result = await client.query<Day>(
      'UPDATE public.trip_days SET name=$3 WHERE trip_id=$1 AND id=$2 RETURNING *',
      [tripId, id, name],
    );
    if (!result.rows[0])
      throw new ApiError(ERRORS.TRIP_DAY_NOT_FOUND, 'ไม่พบวันนี้ในทริป');
    return view(result.rows[0]);
  }
}
