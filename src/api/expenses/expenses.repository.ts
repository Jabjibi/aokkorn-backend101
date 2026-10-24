import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ApiError, ERRORS } from '../../common/api-error.filter.js';
import type { ExpenseInput } from './expenses.dto.js';
import type { ExpenseShare } from './expense-calculations.js';

@Injectable()
export class ExpensesRepository {
  /** I/O: transaction/trip/day → void หรือ 404; ป้องกันอ้างวันข้ามทริป */
  async requireDay(
    client: PoolClient,
    tripId: string,
    id: string,
  ): Promise<void> {
    const day = await client.query(
      'SELECT id FROM public.trip_days WHERE trip_id=$1 AND id=$2',
      [tripId, id],
    );
    if (!day.rows.length)
      throw new ApiError(ERRORS.TRIP_DAY_NOT_FOUND, 'ไม่พบวันนี้ในทริป');
  }

  /** I/O: transaction/trip → id/sortOrder สำหรับ pure split calculator */
  async people(client: PoolClient, tripId: string) {
    return (
      await client.query<{ id: string; sortOrder: number }>(
        'SELECT id,sort_order AS "sortOrder" FROM public.participants WHERE trip_id=$1 ORDER BY sort_order,id',
        [tripId],
      )
    ).rows;
  }

  /** I/O: transaction/trip/DTO → expense UUID; children บันทึกใน transaction ของ service */
  async create(
    client: PoolClient,
    tripId: string,
    input: ExpenseInput,
  ): Promise<string> {
    const value = await client.query<{ id: string }>(
      'INSERT INTO public.expenses(trip_id,day_id,name,amount_minor,currency_code,payer_participant_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
      [
        tripId,
        input.dayId,
        input.name,
        input.amount.minor,
        input.amount.currency,
        input.payerParticipantId,
      ],
    );
    return value.rows[0]!.id;
  }

  /** I/O: transaction/id/DTO → void; service ตรวจ paid lock ก่อนเรียก */
  async update(
    client: PoolClient,
    id: string,
    input: ExpenseInput,
  ): Promise<void> {
    await client.query(
      'UPDATE public.expenses SET day_id=$2,name=$3,amount_minor=$4,currency_code=$5,payer_participant_id=$6 WHERE id=$1',
      [
        id,
        input.dayId,
        input.name,
        input.amount.minor,
        input.amount.currency,
        input.payerParticipantId,
      ],
    );
  }

  /** I/O: financial changes เท่านั้น; upsert debtor เดิมเพื่อรักษา obligation id; caller ต้องตรวจ paid lock */
  async replaceSplit(
    client: PoolClient,
    id: string,
    payerId: string,
    shares: ExpenseShare[],
  ): Promise<void> {
    await client.query(
      'DELETE FROM public.expense_shares WHERE expense_id=$1',
      [id],
    );
    await client.query(
      `INSERT INTO public.expense_shares(expense_id,participant_id,amount_minor,split_order)
       SELECT $1,s.participant_id,s.minor::bigint,s.split_order
       FROM unnest($2::uuid[],$3::text[],$4::int[]) AS s(participant_id,minor,split_order)`,
      [
        id,
        shares.map((s) => s.participantId),
        shares.map((s) => s.amount.minor),
        shares.map((s) => s.splitOrder),
      ],
    );
    const debts = shares.filter(
      (s) => s.participantId !== payerId && BigInt(s.amount.minor) > 0n,
    );
    await client.query(
      'DELETE FROM public.obligations WHERE expense_id=$1 AND NOT(debtor_participant_id=ANY($2::uuid[]))',
      [id, debts.map((s) => s.participantId)],
    );
    await client.query(
      `INSERT INTO public.obligations(expense_id,debtor_participant_id,creditor_participant_id,amount_minor,currency_code)
       SELECT $1,d.participant_id,$2,d.minor::bigint,$3
       FROM unnest($4::uuid[],$5::text[]) AS d(participant_id,minor)
       ON CONFLICT(expense_id,debtor_participant_id) DO UPDATE SET
         creditor_participant_id=EXCLUDED.creditor_participant_id,
         amount_minor=EXCLUDED.amount_minor,currency_code=EXCLUDED.currency_code`,
      [
        id,
        payerId,
        shares[0]!.amount.currency,
        debts.map((d) => d.participantId),
        debts.map((d) => d.amount.minor),
      ],
    );
  }

  /** I/O: transaction/id → void; FK cascade ลบ shares/obligations/snapshots ของรายการนี้ */
  async remove(client: PoolClient, id: string): Promise<void> {
    await client.query('DELETE FROM public.expenses WHERE id=$1', [id]);
  }
}
