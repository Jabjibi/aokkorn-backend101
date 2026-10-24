import { objectInput, currencyInput } from '../../common/input.js';
import { moneyInput, type Money } from '../../common/money.js';
import { ERRORS } from '../../common/api-error.filter.js';
import {
  exchangeInput,
  type ExchangeSelection,
} from '../exchange-rates/exchange.dto.js';

export type SettlementInput = {
  paidAmount: Money;
  exchange?: ExchangeSelection;
};

/** Pure: preview รับเฉพาะสกุลปลายทาง/selection; ไม่มี status/paidAt จาก browser */
export function settlementPreviewInput(value: unknown): {
  currency: string;
  exchange?: ExchangeSelection;
} {
  const body = objectInput(value, ['currency', 'exchange']);
  return {
    currency: currencyInput(body.currency),
    exchange: exchangeInput(body.exchange),
  };
}

export function settlementInput(value: unknown): SettlementInput {
  const body = objectInput(value, ['paidAmount', 'exchange']);
  return {
    paidAmount: moneyInput(
      body.paidAmount,
      ERRORS.SETTLEMENT_PAID_AMOUNT_INVALID,
    ),
    exchange: exchangeInput(body.exchange),
  };
}
