import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ApiError, ERRORS } from '../../common/api-error.filter.js';

type Person = {
  id: string;
  display_name: string;
  is_owner: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
};

function view(p: Person) {
  return {
    id: p.id,
    displayName: p.display_name,
    isOwner: p.is_owner,
    sortOrder: p.sort_order,
    createdAt: p.created_at.toISOString(),
    updatedAt: p.updated_at.toISOString(),
  };
}

/** I/O: ใช้ transaction/owner check ของ service; ไม่เปิด transaction ซ้อน */
@Injectable()
export class ParticipantsRepository {
  /** I/O: client/trip/name → participant ใหม่ลำดับถัดไป; ต้องมี trip lock */
  async create(client: PoolClient, tripId: string, name: string) {
    const result = await client.query<Person>(
      `INSERT INTO public.participants(trip_id,display_name,sort_order,is_owner) SELECT $1,$2,coalesce(max(sort_order),0)+1,false FROM public.participants WHERE trip_id=$1 RETURNING *`,
      [tripId, name],
    );
    return view(result.rows[0]!);
  }

  /** I/O: client/trip/id/name → participant ที่แก้แล้ว หรือ 404 */
  async update(client: PoolClient, tripId: string, id: string, name: string) {
    const result = await client.query<Person>(
      'UPDATE public.participants SET display_name=$3 WHERE trip_id=$1 AND id=$2 RETURNING *',
      [tripId, id, name],
    );
    if (!result.rows[0])
      throw new ApiError(ERRORS.PARTICIPANT_NOT_FOUND, 'ไม่พบผู้ร่วมทริปนี้');
    return view(result.rows[0]);
  }

  /** I/O: client/trip/id → deleted flag; ตรวจ owner participant และ references ก่อนลบ */
  async remove(client: PoolClient, tripId: string, id: string) {
    const result = await client.query<Person>(
      'SELECT * FROM public.participants WHERE trip_id=$1 AND id=$2',
      [tripId, id],
    );
    const person = result.rows[0];
    if (!person)
      throw new ApiError(ERRORS.PARTICIPANT_NOT_FOUND, 'ไม่พบผู้ร่วมทริปนี้');
    if (person.is_owner)
      throw new ApiError(
        ERRORS.PARTICIPANT_OWNER_CANNOT_BE_DELETED,
        'ลบเจ้าของทริปไม่ได้',
      );
    const refs = await client.query<{ used: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM public.expenses WHERE payer_participant_id=$1 UNION ALL SELECT 1 FROM public.expense_shares WHERE participant_id=$1 UNION ALL SELECT 1 FROM public.obligations WHERE debtor_participant_id=$1 OR creditor_participant_id=$1) AS used`,
      [id],
    );
    if (refs.rows[0]!.used)
      throw new ApiError(
        ERRORS.PARTICIPANT_HAS_REFERENCES,
        'มีรายการอ้างอิงผู้ร่วมทริปนี้',
      );
    await client.query(
      'DELETE FROM public.participants WHERE trip_id=$1 AND id=$2',
      [tripId, id],
    );
    return { id, deleted: true };
  }
}
