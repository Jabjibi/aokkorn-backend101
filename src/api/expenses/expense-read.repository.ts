import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ApiError, ERRORS } from '../../common/api-error.filter.js';
import { convertMinor, type Money } from '../../common/money.js';
import type { FxSnapshot } from '../exchange-rates/exchange.dto.js';
import type { ExpenseShare } from './expense-calculations.js';

export type SettlementView = {
  paidAmount: Money;
  paidAt: string;
  fxSnapshot: FxSnapshot | null;
};

export type ObligationView = {
  id: string;
  expenseId: string;
  debtorParticipantId: string;
  creditorParticipantId: string;
  amount: Money;
  converted: Money;
  status: 'paid' | 'unpaid';
  settlement: SettlementView | null;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseView = {
  id: string;
  tripId: string;
  dayId: string;
  name: string;
  amount: Money;
  payerParticipantId: string;
  participantIds: string[];
  shares: (ExpenseShare & { converted: Money })[];
  obligations: ObligationView[];
  fxSnapshot: FxSnapshot | null;
  createdAt: string;
  updatedAt: string;
};

type ExpenseRow = {
  id: string;
  trip_id: string;
  day_id: string;
  name: string;
  amount_minor: string;
  currency_code: string;
  payer_participant_id: string;
  created_at: Date;
  updated_at: Date;
};

type ShareRow = {
  expense_id: string;
  participant_id: string;
  amount_minor: string;
  split_order: number;
};

type RateRow = {
  expense_id: string;
  from_currency: string;
  to_currency: string;
  rate: string;
  source: 'provider' | 'manual';
  captured_at: Date;
  converted_amount_minor: string;
  from_digits: number;
  to_digits: number;
};

type ObligationRow = {
  id: string;
  expense_id: string;
  debtor_participant_id: string;
  creditor_participant_id: string;
  amount_minor: string;
  currency_code: string;
  status: 'paid' | 'unpaid';
  created_at: Date;
  updated_at: Date;
  paid_currency: string | null;
  paid_amount_minor: string | null;
  paid_at: Date | null;
  fx_rate: string | null;
  fx_source: 'manual' | 'provider' | null;
  fx_captured_at: Date | null;
  expected_paid_amount_minor: string | null;
};

function snapshot(row: RateRow): FxSnapshot {
  return {
    fromCurrency: row.from_currency,
    toCurrency: row.to_currency,
    rate: row.rate,
    source: row.source,
    capturedAt: row.captured_at.toISOString(),
    converted: { minor: row.converted_amount_minor, currency: row.to_currency },
  };
}

function obligation(
  row: ObligationRow,
  fx: RateRow | undefined,
): ObligationView {
  const amount = { minor: row.amount_minor, currency: row.currency_code };
  let settlement: SettlementView | null = null;
  if (row.status === 'unpaid' && row.paid_currency)
    throw new ApiError(ERRORS.INTERNAL_ERROR, 'สถานะการจ่ายไม่สอดคล้องกัน');
  if (row.status === 'paid') {
    if (!row.paid_currency || !row.paid_amount_minor || !row.paid_at)
      throw new ApiError(ERRORS.INTERNAL_ERROR, 'ข้อมูลการจ่ายไม่ครบ');
    const paid = { minor: row.paid_amount_minor, currency: row.paid_currency };
    settlement = {
      paidAmount: paid,
      paidAt: row.paid_at.toISOString(),
      fxSnapshot: row.fx_rate
        ? {
            fromCurrency: row.currency_code,
            toCurrency: row.paid_currency,
            rate: row.fx_rate,
            source: row.fx_source!,
            capturedAt: row.fx_captured_at!.toISOString(),
            converted: {
              minor: row.expected_paid_amount_minor!,
              currency: row.paid_currency,
            },
          }
        : null,
    };
  }
  return {
    id: row.id,
    expenseId: row.expense_id,
    debtorParticipantId: row.debtor_participant_id,
    creditorParticipantId: row.creditor_participant_id,
    amount,
    converted: fx
      ? {
          minor: convertMinor(
            row.amount_minor,
            fx.rate,
            fx.from_digits,
            fx.to_digits,
          ),
          currency: fx.to_currency,
        }
      : amount,
    status: row.status,
    settlement,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** I/O read model: caller ตรวจ owner/snapshot แล้ว; batch อ่าน children ไม่ query วนทีละ expense */
@Injectable()
export class ExpenseReadRepository {
  async list(
    client: PoolClient,
    tripId: string,
    baseCurrency: string,
    expenseId?: string,
    dayId?: string,
  ): Promise<ExpenseView[]> {
    const result = await client.query<ExpenseRow>(
      `SELECT id,trip_id,day_id,name,amount_minor::text,currency_code,payer_participant_id,created_at,updated_at FROM public.expenses WHERE trip_id=$1 AND ($2::uuid IS NULL OR id=$2) AND ($3::uuid IS NULL OR day_id=$3) ORDER BY created_at,id`,
      [tripId, expenseId ?? null, dayId ?? null],
    );
    const ids = result.rows.map((e) => e.id);
    if (!ids.length) return [];
    const shares = await client.query<ShareRow>(
      'SELECT expense_id,participant_id,amount_minor::text,split_order FROM public.expense_shares WHERE expense_id=ANY($1::uuid[]) ORDER BY split_order,participant_id',
      [ids],
    );
    const rates = await client.query<RateRow>(
      `SELECT r.expense_id,r.from_currency,r.to_currency,r.rate::text,r.source,r.captured_at,r.converted_amount_minor::text,f.minor_unit_digits AS from_digits,t.minor_unit_digits AS to_digits FROM public.expense_exchange_rates r JOIN public.currencies f ON f.code=r.from_currency JOIN public.currencies t ON t.code=r.to_currency WHERE r.expense_id=ANY($1::uuid[]) AND r.is_current`,
      [ids],
    );
    const obligations = await client.query<ObligationRow>(
      `SELECT o.id,o.expense_id,o.debtor_participant_id,o.creditor_participant_id,o.amount_minor::text,o.currency_code,o.status,o.created_at,o.updated_at,s.paid_currency,s.paid_amount_minor::text,s.paid_at,s.fx_rate::text,s.fx_source,s.fx_captured_at,s.expected_paid_amount_minor::text FROM public.obligations o LEFT JOIN public.obligation_settlements s ON s.obligation_id=o.id WHERE o.expense_id=ANY($1::uuid[]) ORDER BY o.created_at,o.id`,
      [ids],
    );
    return result.rows.map((e) => {
      const fx = rates.rows.find((r) => r.expense_id === e.id);
      if (
        e.currency_code !== baseCurrency &&
        (!fx ||
          fx.from_currency !== e.currency_code ||
          fx.to_currency !== baseCurrency)
      )
        throw new ApiError(ERRORS.INTERNAL_ERROR, 'อัตราของรายการไม่ครบ');
      const expenseShares = shares.rows
        .filter((s) => s.expense_id === e.id)
        .map((s) => ({
          participantId: s.participant_id,
          amount: { minor: s.amount_minor, currency: e.currency_code },
          splitOrder: s.split_order,
          converted: fx
            ? {
                minor: convertMinor(
                  s.amount_minor,
                  fx.rate,
                  fx.from_digits,
                  fx.to_digits,
                ),
                currency: fx.to_currency,
              }
            : { minor: s.amount_minor, currency: e.currency_code },
        }));
      return {
        id: e.id,
        tripId: e.trip_id,
        dayId: e.day_id,
        name: e.name,
        amount: { minor: e.amount_minor, currency: e.currency_code },
        payerParticipantId: e.payer_participant_id,
        participantIds: expenseShares.map((s) => s.participantId),
        shares: expenseShares,
        obligations: obligations.rows
          .filter((o) => o.expense_id === e.id)
          .map((o) => obligation(o, fx)),
        fxSnapshot: fx ? snapshot(fx) : null,
        createdAt: e.created_at.toISOString(),
        updatedAt: e.updated_at.toISOString(),
      };
    });
  }

  /** I/O: transaction/trip/base/id → ExpenseView หรือ 404 */
  async require(
    client: PoolClient,
    tripId: string,
    base: string,
    id: string,
  ): Promise<ExpenseView> {
    const value = (await this.list(client, tripId, base, id))[0];
    if (!value)
      throw new ApiError(ERRORS.EXPENSE_NOT_FOUND, 'ไม่พบรายการนี้ในทริป');
    return value;
  }

  /** I/O: transaction/trip/base/obligation → ภาระและ settlement ที่อยู่ในทริปนี้ */
  async obligation(
    client: PoolClient,
    tripId: string,
    base: string,
    id: string,
  ): Promise<ObligationView> {
    const result = await client.query<{ expense_id: string }>(
      'SELECT o.expense_id FROM public.obligations o JOIN public.expenses e ON e.id=o.expense_id WHERE e.trip_id=$1 AND o.id=$2',
      [tripId, id],
    );
    if (!result.rows[0])
      throw new ApiError(
        ERRORS.OBLIGATION_NOT_FOUND,
        'ไม่พบภาระการจ่ายนี้ในทริป',
      );
    const expense = await this.require(
      client,
      tripId,
      base,
      result.rows[0].expense_id,
    );
    const value = expense.obligations.find((o) => o.id === id);
    if (!value)
      throw new ApiError(ERRORS.OBLIGATION_NOT_FOUND, 'ไม่พบภาระการจ่ายนี้');
    return value;
  }
}
