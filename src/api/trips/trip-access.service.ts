import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service.js';
import { ApiError, ERRORS } from '../../common/api-error.filter.js';

export type OwnedTrip = { id: string; base_currency_code: string };

/** I/O boundary ร่วม: owner filter + snapshot/row lock ก่อนอ่านหรือแก้ resource ลูก */
@Injectable()
export class TripAccessService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** I/O: actor/trip/callback → callback result; writes ของทริปเดียวกันรอกันเพื่อป้องกัน race */
  run<T>(
    ownerId: string,
    tripId: string,
    write: boolean,
    work: (client: PoolClient, trip: OwnedTrip) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (client) => {
      const found = await client.query<OwnedTrip>(
        `SELECT id,base_currency_code FROM public.trips WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL${write ? ' FOR UPDATE' : ''}`,
        [tripId, ownerId],
      );
      if (!found.rows[0])
        throw new ApiError(ERRORS.TRIP_NOT_FOUND, 'ไม่พบทริปนี้');
      const result = await work(client, found.rows[0]);
      return result;
    }, !write);
  }
}
