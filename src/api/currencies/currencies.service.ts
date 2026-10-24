import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service.js';
import { ApiError, ERRORS } from '../../common/api-error.filter.js';
import type { ErrorEntry } from '../../common/input.js';

export type Currency = {
  code: string;
  symbol: string;
  minorUnitDigits: number;
};

@Injectable()
export class CurrenciesService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** I/O: ไม่มี input → รายการ reference currencies; ไม่มี seed อัตโนมัติ */
  async list(): Promise<Currency[]> {
    const rows = await this.db.query<{
      code: string;
      symbol: string;
      minor_unit_digits: number;
    }>(
      'SELECT code,symbol,minor_unit_digits FROM public.currencies ORDER BY code',
    );
    return rows.rows.map((row) => ({
      code: row.code,
      symbol: row.symbol,
      minorUnitDigits: row.minor_unit_digits,
    }));
  }

  /** I/O: code + optional transaction → metadata หรือ feature error; ไม่เดา decimal digits */
  async require(
    code: string,
    error: ErrorEntry = ERRORS.EXPENSE_CURRENCY_UNSUPPORTED,
    client?: PoolClient,
  ): Promise<Currency> {
    const sql =
      'SELECT code,symbol,minor_unit_digits FROM public.currencies WHERE code=$1';
    const result = client
      ? await client.query<{
          code: string;
          symbol: string;
          minor_unit_digits: number;
        }>(sql, [code])
      : await this.db.query<{
          code: string;
          symbol: string;
          minor_unit_digits: number;
        }>(sql, [code]);
    const row = result.rows[0];
    if (!row) throw new ApiError(error, 'ระบบไม่รองรับสกุลเงินนี้');
    return {
      code: row.code,
      symbol: row.symbol,
      minorUnitDigits: row.minor_unit_digits,
    };
  }
}
