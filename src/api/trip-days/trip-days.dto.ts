import { objectInput, nameInput } from '../../common/input.js';
import { ERRORS } from '../../common/api-error.filter.js';

/** Pure: create อาจไม่ส่งชื่อเพื่อให้ระบบออก วัน N; PATCH ต้องส่งชื่อ */
export function createDayInput(value: unknown): { name?: string } {
  const body = objectInput(value ?? {}, ['name']);
  return 'name' in body
    ? { name: nameInput(body.name, ERRORS.TRIP_DAY_NAME_REQUIRED) }
    : {};
}

export function updateDayInput(value: unknown): { name: string } {
  const body = objectInput(value, ['name']);
  return { name: nameInput(body.name, ERRORS.TRIP_DAY_NAME_REQUIRED) };
}
