import { ParseUUIDPipe, type PipeTransform } from '@nestjs/common';
import { ApiError, ERRORS } from './api-error.filter.js';

export type ErrorEntry = (typeof ERRORS)[keyof typeof ERRORS];

export const MAX_NAME_LENGTH = 80;

export const MAX_EXPENSE_NAME_LENGTH = 200;

export const MAX_SELECTED_PARTICIPANTS = 1000;

/** Pure: unknown → object ที่มีเฉพาะ fields ที่ประกาศ; ห้าม mass assignment */
export function objectInput(
  value: unknown,
  fields: string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !fields.includes(key))) invalid();
  return body;
}

export function invalid(): never {
  throw new ApiError(ERRORS.VALIDATION_FAILED, 'ข้อมูลคำขอไม่ถูกต้อง');
}

/** Pure: input → ชื่อที่ trim แล้ว; error เฉพาะ feature สำหรับชื่อว่าง/ยาว */
export function nameInput(
  value: unknown,
  required: ErrorEntry,
  max = MAX_NAME_LENGTH,
  tooLong: ErrorEntry = ERRORS.VALIDATION_FAILED,
): string {
  if (typeof value !== 'string') invalid();
  const name = value.trim();
  if (!name) throw new ApiError(required, 'กรุณาระบุชื่อ');
  if (
    Array.from(name).length > max ||
    Array.from(name).some(
      (character) =>
        character.codePointAt(0)! < 32 || character.codePointAt(0) === 127,
    )
  )
    throw new ApiError(tooLong, 'ชื่อยาวเกินกำหนดหรือมีอักขระที่ไม่รองรับ');
  return name;
}

export function currencyInput(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) invalid();
  return value;
}

export function idInput(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    invalid();
  return value.toLowerCase();
}

/** HTTP pipe: แยก validation ออกจาก controller; parser เป็น pure function ทดสอบตรงได้ */
export class BodyPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly parse: (value: unknown) => T) {}

  transform(value: unknown): T {
    return this.parse(value);
  }
}

export class IdPipe extends ParseUUIDPipe {
  constructor() {
    super({
      version: 'all',
      exceptionFactory: () =>
        new ApiError(ERRORS.VALIDATION_FAILED, 'รหัสไม่ถูกต้อง'),
    });
  }

  override async transform(
    value: string,
    metadata: Parameters<ParseUUIDPipe['transform']>[1],
  ): Promise<string> {
    const result = await super.transform(value, metadata);
    if (typeof result !== 'string') invalid();
    return result.toLowerCase();
  }
}

export class EmptyQueryPipe implements PipeTransform<
  Record<string, unknown>,
  void
> {
  transform(value: Record<string, unknown>): void {
    if (Object.keys(value).length) invalid();
  }
}
