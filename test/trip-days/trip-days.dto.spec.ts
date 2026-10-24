import {
  createDayInput,
  updateDayInput,
} from '../../src/api/trip-days/trip-days.dto.js';
describe('trip day input contract', () => {
  it('allows an automatic name only when creating a day', () => {
    expect(createDayInput({})).toEqual({});
    expect(updateDayInput({ name: '  เที่ยวเมือง  ' })).toEqual({
      name: 'เที่ยวเมือง',
    });
    expect(() => updateDayInput({})).toThrow();
    expect(() => createDayInput({ name: ' ' })).toThrow(
      expect.objectContaining({ errorCode: 'AOK-4101' }),
    );
  });
  it('rejects client-controlled order/date and control characters', () => {
    expect(() => createDayInput({ sortOrder: 1 })).toThrow();
    expect(() => updateDayInput({ name: 'วัน\u0000' })).toThrow();
  });
});
