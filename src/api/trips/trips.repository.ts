import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service.js';
import { ApiError, ERRORS } from '../../common/api-error.filter.js';
import {
  TRIP_LIMIT,
  type Money,
  type CreateTripInput,
  type TripView,
  type TripDetail,
} from './trips.dto.js';

interface TripRow {
  id: string;
  name: string;
  base_currency_code: string;
  created_at: Date;
  updated_at: Date;
  participant_count: number;
  expense_count: number;
  total_minor: string;
  original_totals: Money[];
  missing_rate: boolean;
}

interface ParticipantRow {
  id: string;
  display_name: string;
  sort_order: number;
  is_owner: boolean;
  created_at: Date;
  updated_at: Date;
}

interface DayRow {
  id: string;
  name: string;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
  expense_count: number;
  total_minor: string;
  original_totals: Money[];
  missing_rate: boolean;
}

// ดึงรายการทริปด้วย SQL เดียว; aggregate แยกจาก participants เพื่อไม่คูณยอดจาก JOIN หลายฝั่ง
// ยอดต้นทางไม่แปลงสกุลและไม่ใช้ Number; currency ordering คงที่ให้ UI ใช้ได้ตรง ๆ
const originalTripTotalsSql = `coalesce((SELECT jsonb_agg(s.money ORDER BY s.currency_code) FROM (
  SELECT e.currency_code, jsonb_build_object('currency',e.currency_code,'minor',sum(e.amount_minor)::text) AS money
  FROM public.expenses e WHERE e.trip_id=t.id GROUP BY e.currency_code
) s),'[]'::jsonb)`;

const summarySql = `SELECT t.id,t.name,t.base_currency_code,t.created_at,t.updated_at,
  ${originalTripTotalsSql} AS original_totals,
  (SELECT count(*)::int FROM public.participants p WHERE p.trip_id=t.id) AS participant_count,
  (SELECT count(*)::int FROM public.expenses e WHERE e.trip_id=t.id) AS expense_count,
  coalesce((SELECT sum(CASE WHEN e.currency_code=t.base_currency_code THEN e.amount_minor ELSE r.converted_amount_minor END)
    FROM public.expenses e LEFT JOIN public.expense_exchange_rates r ON r.expense_id=e.id AND r.is_current
    WHERE e.trip_id=t.id),0)::text AS total_minor,
  EXISTS(SELECT 1 FROM public.expenses e LEFT JOIN public.expense_exchange_rates r ON r.expense_id=e.id AND r.is_current
    WHERE e.trip_id=t.id AND e.currency_code<>t.base_currency_code
      AND (r.id IS NULL OR r.from_currency<>e.currency_code OR r.to_currency<>t.base_currency_code)) AS missing_rate
  FROM public.trips t WHERE t.owner_user_id=$1 AND t.deleted_at IS NULL`;

/** Pure: DB row → public DTO; ไม่คืน owner_user_id และไม่ส่งยอดที่แปลงไม่ครบ */
function tripView(row: TripRow): TripView {
  assertCompleteRates(row.missing_rate);
  return {
    id: row.id,
    name: row.name,
    baseCurrency: row.base_currency_code,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    participantCount: row.participant_count,
    expenseCount: row.expense_count,
    total: { minor: row.total_minor, currency: row.base_currency_code },
    originalTotals: row.original_totals,
  };
}

function assertCompleteRates(missing: boolean): void {
  if (missing)
    throw new ApiError(
      ERRORS.INTERNAL_ERROR,
      'ไม่สามารถอ่านยอดทริปได้ กรุณาลองใหม่',
    );
}

/** SQL/transaction ของทริป; ไม่รับ owner จาก body และไม่มี network ไปบริการภายนอก */
@Injectable()
export class TripsRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /** I/O: ownerId → ทริปที่ยังไม่ลบ; parameterized query ป้องกันการสวม owner/SQL injection */
  async list(ownerId: string): Promise<TripView[]> {
    const result = await this.database.query<TripRow>(
      summarySql + ' ORDER BY t.created_at DESC,t.id DESC',
      [ownerId],
    );
    return result.rows.map(tripView);
  }

  /** I/O: ownerId + tripId → รายละเอียดจาก snapshot เดียว; ไม่มีสิทธิ์/ลบแล้ว/ไม่พบ ตอบ 404 เหมือนกัน */
  async detail(ownerId: string, tripId: string): Promise<TripDetail> {
    return this.database.transaction(
      (client) => this.readDetail(client, ownerId, tripId),
      true,
    );
  }

  /** I/O atomic: lock owner → quota/currency → Trip + owner participant + วัน 1 → public detail */
  async create(ownerId: string, input: CreateTripInput): Promise<TripDetail> {
    return this.database.transaction(async (client) => {
      // ทุก create ของ owner เดียวกันต้องรอ lock นี้ก่อน COUNT; ใช้ READ COMMITTED snapshot ใหม่หลังรอ
      const owner = await client.query<{ display_name: string }>(
        'SELECT display_name FROM public.users WHERE id=$1 FOR UPDATE',
        [ownerId],
      );
      if (!owner.rows[0])
        throw new ApiError(ERRORS.SESSION_MISSING, 'กรุณาเข้าสู่ระบบ');
      const count = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM public.trips WHERE owner_user_id=$1 AND deleted_at IS NULL',
        [ownerId],
      );
      if (count.rows[0]!.count >= TRIP_LIMIT)
        throw new ApiError(
          ERRORS.TRIP_LIMIT_EXCEEDED,
          'คุณมีทริปครบ 5 ทริปแล้ว',
          { activeTripCount: count.rows[0]!.count, limit: TRIP_LIMIT },
        );
      const currency = await client.query(
        'SELECT code FROM public.currencies WHERE code=$1',
        [input.baseCurrency],
      );
      if (!currency.rows.length)
        throw new ApiError(
          ERRORS.TRIP_BASE_CURRENCY_UNSUPPORTED,
          'ระบบยังไม่รองรับสกุลเงินนี้',
        );
      const created = await client.query<{ id: string }>(
        'INSERT INTO public.trips(owner_user_id,name,base_currency_code) VALUES($1,$2,$3) RETURNING id',
        [ownerId, input.name, input.baseCurrency],
      );
      const tripId = created.rows[0]!.id;
      await client.query(
        'INSERT INTO public.participants(trip_id,display_name,sort_order,is_owner) VALUES($1,$2,1,true)',
        [tripId, owner.rows[0].display_name],
      );
      await client.query(
        'INSERT INTO public.trip_days(trip_id,name,sort_order) VALUES($1,$2,1)',
        [tripId, 'วัน 1'],
      );
      return this.readDetail(client, ownerId, tripId);
    });
  }

  /** I/O ภายใน transaction: client + ownerId + tripId → DTO พร้อม participants/days; ไม่เปิด transaction ซ้อน */
  async readDetail(
    client: PoolClient,
    ownerId: string,
    tripId: string,
  ): Promise<TripDetail> {
    const trips = await client.query<TripRow>(summarySql + ' AND t.id=$2', [
      ownerId,
      tripId,
    ]);
    if (!trips.rows[0])
      throw new ApiError(ERRORS.TRIP_NOT_FOUND, 'ไม่พบทริปนี้');
    const trip = tripView(trips.rows[0]);
    const people = await client.query<ParticipantRow>(
      'SELECT id,display_name,sort_order,is_owner,created_at,updated_at FROM public.participants WHERE trip_id=$1 ORDER BY sort_order,id',
      [tripId],
    );
    const days = await client.query<DayRow>(
      `SELECT d.id,d.name,d.sort_order,d.created_at,d.updated_at,
      coalesce((SELECT jsonb_agg(s.money ORDER BY s.currency_code) FROM (
        SELECT x.currency_code, jsonb_build_object('currency',x.currency_code,'minor',sum(x.amount_minor)::text) AS money
        FROM public.expenses x WHERE x.trip_id=d.trip_id AND x.day_id=d.id GROUP BY x.currency_code
      ) s),'[]'::jsonb) AS original_totals,
      count(e.id)::int AS expense_count,
      coalesce(sum(CASE WHEN e.currency_code=$2 THEN e.amount_minor ELSE r.converted_amount_minor END),0)::text AS total_minor,
      coalesce(bool_or(e.currency_code<>$2 AND (r.id IS NULL OR r.from_currency<>e.currency_code OR r.to_currency<>$2)),false) AS missing_rate
      FROM public.trip_days d LEFT JOIN public.expenses e ON e.day_id=d.id AND e.trip_id=d.trip_id
      LEFT JOIN public.expense_exchange_rates r ON r.expense_id=e.id AND r.is_current
      WHERE d.trip_id=$1 GROUP BY d.id ORDER BY d.sort_order,d.id`,
      [tripId, trip.baseCurrency],
    );
    return {
      ...trip,
      participants: people.rows.map((p) => ({
        id: p.id,
        displayName: p.display_name,
        sortOrder: p.sort_order,
        isOwner: p.is_owner,
        createdAt: p.created_at.toISOString(),
        updatedAt: p.updated_at.toISOString(),
      })),
      days: days.rows.map((d) => {
        assertCompleteRates(d.missing_rate);
        return {
          id: d.id,
          name: d.name,
          sortOrder: d.sort_order,
          createdAt: d.created_at.toISOString(),
          updatedAt: d.updated_at.toISOString(),
          expenseCount: d.expense_count,
          total: { minor: d.total_minor, currency: trip.baseCurrency },
          originalTotals: d.original_totals,
        };
      }),
    };
  }
}
