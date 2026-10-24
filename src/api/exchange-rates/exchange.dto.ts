import { objectInput, invalid, currencyInput } from '../../common/input.js';
import { rateInput, type Money } from '../../common/money.js';

export type ExchangeSelection = { manualRate: string } | { quoteId: string };

export type FxSnapshot = {
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  source: 'manual' | 'provider';
  capturedAt: string;
  converted: Money;
};

/** Pure: unknown → selection เดียว; client ส่ง source/capturedAt/converted เองไม่ได้ */
export function exchangeInput(value: unknown): ExchangeSelection | undefined {
  if (value === undefined) return undefined;
  const body = objectInput(value, ['manualRate', 'quoteId']);
  if (Object.keys(body).length !== 1) invalid();
  if (body.manualRate !== undefined)
    return { manualRate: rateInput(body.manualRate) };
  if (
    typeof body.quoteId !== 'string' ||
    !body.quoteId ||
    body.quoteId.length > 2048
  )
    invalid();
  return { quoteId: body.quoteId };
}

export function quoteQuery(value: unknown): { from: string; to: string } {
  const query = objectInput(value, ['from', 'to']);
  return { from: currencyInput(query.from), to: currencyInput(query.to) };
}
