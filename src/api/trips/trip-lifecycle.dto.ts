import {
  nameInput,
  objectInput,
  currencyInput,
  invalid,
} from '../../common/input.js';
import { ERRORS } from '../../common/api-error.filter.js';
import {
  exchangeInput,
  type ExchangeSelection,
} from '../exchange-rates/exchange.dto.js';

export type UpdateTrip = {
  name?: string;
  baseCurrency?: string;
  exchangeSelections?: Record<string, ExchangeSelection>;
};

/** Pure: PATCH whitelist → typed partial input; ไม่รับ fields ระบบ */
export function updateTripInput(value: unknown): UpdateTrip {
  const body = objectInput(value, [
    'name',
    'baseCurrency',
    'exchangeSelections',
  ]);
  if (!Object.keys(body).length) invalid();
  const result: UpdateTrip = {};
  if ('name' in body)
    result.name = nameInput(body.name, ERRORS.TRIP_NAME_REQUIRED);
  if ('baseCurrency' in body)
    result.baseCurrency = currencyInput(body.baseCurrency);
  if ('exchangeSelections' in body) {
    if (
      !result.baseCurrency ||
      !body.exchangeSelections ||
      typeof body.exchangeSelections !== 'object' ||
      Array.isArray(body.exchangeSelections)
    )
      invalid();
    result.exchangeSelections = {};
    for (const [currency, selection] of Object.entries(body.exchangeSelections))
      result.exchangeSelections[currencyInput(currency)] =
        exchangeInput(selection)!;
  }
  return result;
}

export function emptyBody(value: unknown): void {
  objectInput(value ?? {}, []);
}
