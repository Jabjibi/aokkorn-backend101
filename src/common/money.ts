import { ApiError, ERRORS } from './api-error.filter.js';
import { objectInput, currencyInput, type ErrorEntry } from './input.js';

export type Money = { minor: string; currency: string };

export const MAX_MINOR = 9223372036854775807n;

/** Pure: JSON Money → canonical positive integer string; ไม่ผ่าน Number */
export function moneyInput(
  value: unknown,
  error: ErrorEntry = ERRORS.EXPENSE_AMOUNT_INVALID,
): Money {
  const body = objectInput(value, ['minor', 'currency']);
  if (typeof body.minor !== 'string' || !/^[0-9]{1,19}$/.test(body.minor))
    throw new ApiError(error, 'จำนวนเงินไม่ถูกต้อง');
  const amount = BigInt(body.minor);
  if (amount <= 0n || amount > MAX_MINOR)
    throw new ApiError(error, 'จำนวนเงินต้องมากกว่า 0 และไม่เกิน bigint');
  return { minor: amount.toString(), currency: currencyInput(body.currency) };
}

/** Pure: decimal string → canonical decimal; ตรง numeric(30,15) ไม่ปัดอัตราเงียบ ๆ */
export function rateInput(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 64 ||
    !/^\d+(?:\.\d+)?$/.test(value)
  )
    throw new ApiError(
      ERRORS.EXCHANGE_RATE_INVALID,
      'อัตราแลกเปลี่ยนไม่ถูกต้อง',
    );
  const [whole, fraction = ''] = value.split('.');
  const integer = whole!.replace(/^0+(?=\d)/, '');
  const digits = fraction.replace(/0+$/, '');
  if (
    integer.length > 15 ||
    digits.length > 15 ||
    BigInt(integer + digits) <= 0n
  )
    throw new ApiError(
      ERRORS.EXCHANGE_RATE_INVALID,
      'อัตราต้องมากกว่า 0 และไม่เกินความละเอียดที่รองรับ',
    );
  return digits ? `${integer}.${digits}` : integer;
}

/** Pure: minor + decimal rate + currency digits → minor string, half-up ครั้งเดียว */
export function convertMinor(
  minor: string,
  rate: string,
  fromDigits: number,
  toDigits: number,
): string {
  const [whole, fraction = ''] = rateInput(rate).split('.');
  const numerator =
    BigInt(minor) * BigInt(whole! + fraction) * 10n ** BigInt(toDigits);
  const denominator = 10n ** BigInt(fromDigits + fraction.length);
  const result = (2n * numerator + denominator) / (2n * denominator);
  if (result > MAX_MINOR)
    throw new ApiError(
      ERRORS.EXCHANGE_RATE_INVALID,
      'ยอดแปลงเกินขอบเขตที่รองรับ',
    );
  return result.toString();
}

/** Pure: รวมยอดแยกสกุล; ไม่หักกลบภาระการจ่ายและไม่รวมเงินต่างสกุล */
export function sumMoney(values: Money[]): Money[] {
  const sums = new Map<string, bigint>();
  for (const money of values)
    sums.set(
      money.currency,
      (sums.get(money.currency) ?? 0n) + BigInt(money.minor),
    );
  return [...sums]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, minor]) => ({ currency, minor: minor.toString() }));
}
