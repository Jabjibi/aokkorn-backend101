import { ApiError, ERRORS } from '../../common/api-error.filter.js';
import {
  objectInput,
  nameInput,
  idInput,
  currencyInput,
  invalid,
  MAX_EXPENSE_NAME_LENGTH,
  MAX_SELECTED_PARTICIPANTS,
} from '../../common/input.js';
import { moneyInput, type Money } from '../../common/money.js';
import {
  exchangeInput,
  type ExchangeSelection,
} from '../exchange-rates/exchange.dto.js';

export type ExpenseInput = {
  dayId: string;
  name: string;
  amount: Money;
  payerParticipantId: string;
  participantIds: string[];
  exchange?: ExchangeSelection;
};

export type ExpensePatch = Partial<ExpenseInput>;

function selectedIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_SELECTED_PARTICIPANTS)
    invalid();
  const ids = value.map(idInput);
  if (new Set(ids).size !== ids.length)
    throw new ApiError(ERRORS.SHARE_DUPLICATE_PARTICIPANT, 'รายชื่อคนหารซ้ำ');
  return ids;
}

/** Pure: create/PATCH body → typed fields; ไม่รับ shares/obligations/status จาก client */
export function expensePatchInput(value: unknown): ExpensePatch {
  const body = objectInput(value, [
    'dayId',
    'name',
    'amount',
    'payerParticipantId',
    'participantIds',
    'exchange',
  ]);
  if (!Object.keys(body).length) invalid();
  const result: ExpensePatch = {};
  if ('dayId' in body) result.dayId = idInput(body.dayId);
  if ('name' in body)
    result.name = nameInput(
      body.name,
      ERRORS.EXPENSE_NAME_REQUIRED,
      MAX_EXPENSE_NAME_LENGTH,
      ERRORS.EXPENSE_NAME_TOO_LONG,
    );
  if ('amount' in body) result.amount = moneyInput(body.amount);
  if ('payerParticipantId' in body) {
    if (!body.payerParticipantId)
      throw new ApiError(ERRORS.EXPENSE_PAYER_REQUIRED, 'กรุณาระบุผู้จ่าย');
    result.payerParticipantId = idInput(body.payerParticipantId);
  }
  if ('participantIds' in body)
    result.participantIds = selectedIds(body.participantIds);
  if ('exchange' in body) result.exchange = exchangeInput(body.exchange);
  return result;
}

export function expenseInput(value: unknown): ExpenseInput {
  const result = expensePatchInput(value);
  if (!result.payerParticipantId)
    throw new ApiError(ERRORS.EXPENSE_PAYER_REQUIRED, 'กรุณาระบุผู้จ่าย');
  if (!result.dayId || !result.name || !result.amount || !result.participantIds)
    invalid();
  return result as ExpenseInput;
}

export function parseTextInput(value: unknown): {
  text: string;
  currency: string;
} {
  const body = objectInput(value, ['text', 'currency']);
  if (
    typeof body.text !== 'string' ||
    body.text.length > 2048 ||
    body.text.includes('\u0000')
  )
    invalid();
  return { text: body.text, currency: currencyInput(body.currency) };
}
