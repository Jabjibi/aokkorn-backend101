import { ApiError, ERRORS } from '../../common/api-error.filter.js';
import { MAX_EXPENSE_NAME_LENGTH, nameInput } from '../../common/input.js';
import { moneyInput, type Money } from '../../common/money.js';

export type SplitPerson = { id: string; sortOrder: number };

export type ExpenseShare = {
  participantId: string;
  amount: Money;
  splitOrder: number;
};

/** Pure: ข้อความ + metadata สกุลเงิน → ชื่อ/เงิน; ตรวจ token ท้ายทั้งหมด ไม่แอบข้ามจำนวนที่ผิด */
export function parseExpenseText(
  text: string,
  currency: string,
  digits: number,
): { name: string; amount: Money } {
  const tokens = text.trim().split(/\s+/u);
  const token = tokens.pop() ?? '';
  if (!/[0-9]/.test(token) || !/^[+-]?[0-9.,]+$/.test(token))
    throw new ApiError(
      ERRORS.EXPENSE_AMOUNT_NOT_FOUND,
      'ไม่พบจำนวนเงินท้ายข้อความ',
    );
  if (!/^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]+)?$/.test(token))
    throw new ApiError(
      ERRORS.EXPENSE_AMOUNT_INVALID,
      'รูปแบบจำนวนเงินไม่ถูกต้อง',
    );
  const [whole, fraction = ''] = token.replaceAll(',', '').split('.');
  if (fraction.length > digits || (token.includes('.') && digits === 0))
    throw new ApiError(
      ERRORS.EXPENSE_AMOUNT_INVALID,
      'ทศนิยมมากกว่าที่สกุลเงินรองรับ',
    );
  const minor = (whole! + fraction.padEnd(digits, '0')).replace(
    /^0+(?=\d)/,
    '',
  );
  const amount = moneyInput({ minor, currency });
  const name = nameInput(
    tokens.join(' '),
    ERRORS.EXPENSE_NAME_REQUIRED,
    MAX_EXPENSE_NAME_LENGTH,
    ERRORS.EXPENSE_NAME_TOO_LONG,
  );
  return { name, amount };
}

/** Pure: amount/payer/selected/people → shares; payer ก่อน แล้ว sortOrder/id, เศษไม่สูญหาย */
export function splitExpense(
  amount: Money,
  payerId: string,
  selected: string[],
  people: SplitPerson[],
): ExpenseShare[] {
  if (new Set(selected).size !== selected.length)
    throw new ApiError(ERRORS.SHARE_DUPLICATE_PARTICIPANT, 'รายชื่อคนหารซ้ำ');
  const known = new Map(people.map((person) => [person.id, person]));
  if (!known.has(payerId))
    throw new ApiError(
      ERRORS.EXPENSE_PAYER_NOT_IN_TRIP,
      'ผู้จ่ายไม่ได้อยู่ในทริป',
    );
  if (selected.some((id) => !known.has(id)))
    throw new ApiError(
      ERRORS.SHARE_PARTICIPANT_NOT_IN_TRIP,
      'คนหารไม่ได้อยู่ในทริป',
    );
  const ids = [...new Set([payerId, ...selected])].sort((a, b) =>
    a === b
      ? 0
      : a === payerId
        ? -1
        : b === payerId
          ? 1
          : known.get(a)!.sortOrder - known.get(b)!.sortOrder ||
            a.localeCompare(b),
  );
  const total = BigInt(amount.minor),
    count = BigInt(ids.length),
    quotient = total / count,
    remainder = total % count;
  const shares = ids.map((participantId, index) => ({
    participantId,
    amount: {
      minor: (quotient + (BigInt(index) < remainder ? 1n : 0n)).toString(),
      currency: amount.currency,
    },
    splitOrder: index + 1,
  }));
  if (
    shares.reduce((sum, share) => sum + BigInt(share.amount.minor), 0n) !==
    total
  )
    throw new ApiError(
      ERRORS.SHARE_ROUNDING_INVARIANT_VIOLATED,
      'ผลรวมส่วนแบ่งไม่ถูกต้อง',
    );
  return shares;
}
