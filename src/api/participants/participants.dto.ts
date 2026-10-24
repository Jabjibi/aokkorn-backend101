import { objectInput, nameInput, MAX_NAME_LENGTH } from '../../common/input.js';
import { ERRORS } from '../../common/api-error.filter.js';

/** Pure: unknown → ชื่อ guest เท่านั้น; ไม่รับ isOwner/sortOrder/userId */
export function participantInput(value: unknown): { displayName: string } {
  const body = objectInput(value, ['displayName']);
  return {
    displayName: nameInput(
      body.displayName,
      ERRORS.PARTICIPANT_NAME_REQUIRED,
      MAX_NAME_LENGTH,
      ERRORS.PARTICIPANT_NAME_TOO_LONG,
    ),
  };
}
