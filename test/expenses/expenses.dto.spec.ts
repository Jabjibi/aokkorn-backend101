import {
  expenseInput,
  expensePatchInput,
} from '../../src/api/expenses/expenses.dto.js';
const id = '11b93398-395e-42c0-ac32-46a6ac15c5b3';
const input = {
  dayId: id,
  name: 'อาหาร',
  amount: { minor: '1000', currency: 'THB' },
  payerParticipantId: id,
  participantIds: [],
};
describe('expense input contract', () => {
  it('requires a payer and treats an empty guest selection as explicit', () => {
    expect(expenseInput(input)).toEqual(input);
    expect(() =>
      expenseInput({ ...input, payerParticipantId: undefined }),
    ).toThrow(expect.objectContaining({ errorCode: 'AOK-5301' }));
    expect(() => expenseInput({ ...input, participantIds: [id, id] })).toThrow(
      expect.objectContaining({ errorCode: 'AOK-6002' }),
    );
  });
  it.each(['shares', 'obligations', 'status', 'ownerUserId', 'createdAt'])(
    'rejects computed/system field %s',
    (field) => {
      expect(() =>
        expensePatchInput({ name: 'new', [field]: 'forged' }),
      ).toThrow(expect.objectContaining({ errorCode: 'AOK-9001' }));
    },
  );
});
