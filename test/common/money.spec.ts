import {
  convertMinor,
  moneyInput,
  rateInput,
  MAX_MINOR,
  sumMoney,
} from '../../src/common/money.js';
import {
  parseExpenseText,
  splitExpense,
} from '../../src/api/expenses/expense-calculations.js';
describe('exact decimal money and deterministic splitting (pure)', () => {
  it.each([
    ['501', '0.23', 0, 2, '11523'],
    ['1', '0.005', 0, 2, '1'],
    ['1', '0.004999999999999', 0, 2, '0'],
    ['100', '1', 2, 0, '1'],
    ['150', '1', 2, 0, '2'],
    ['9007199254740993', '1', 2, 2, '9007199254740993'],
  ])(
    'converts %s at %s without binary floating point',
    (minor, rate, from, to, expected) => {
      expect(
        convertMinor(String(minor), String(rate), Number(from), Number(to)),
      ).toBe(expected);
    },
  );
  it.each(['0', '-1', '1e2', 'NaN', '0.0000000000000001', '1000000000000000'])(
    'rejects invalid or unrepresentable rate %s',
    (rate) => {
      expect(() => rateInput(rate)).toThrow(
        expect.objectContaining({ errorCode: 'AOK-7001' }),
      );
    },
  );
  it.each(['0', '-1', '1.2', '1e3', (MAX_MINOR + 1n).toString()])(
    'rejects invalid minor %s',
    (minor) => {
      expect(() => moneyInput({ minor, currency: 'THB' })).toThrow(
        expect.objectContaining({ errorCode: 'AOK-5102' }),
      );
    },
  );
  it('normalizes decimal text without rounding and rejects conversion overflow', () => {
    expect(rateInput('000.230000000000000')).toBe('0.23');
    expect(() => convertMinor(MAX_MINOR.toString(), '2', 0, 0)).toThrow();
    expect(
      sumMoney([
        { minor: '9007199254740993', currency: 'THB' },
        { minor: '1', currency: 'THB' },
        { minor: '2', currency: 'USD' },
      ]),
    ).toEqual([
      { minor: '9007199254740994', currency: 'THB' },
      { minor: '2', currency: 'USD' },
    ]);
  });
  it.each([
    ['น้ำ 3 ขวด 120', 'THB', 2, 'น้ำ 3 ขวด', '12000'],
    ['อาหาร 1,250.50', 'THB', 2, 'อาหาร', '125050'],
    ['ตั๋ว 501', 'JPY', 0, 'ตั๋ว', '501'],
  ])(
    'parses %s using currency digits',
    (text, currency, digits, name, minor) => {
      expect(
        parseExpenseText(String(text), String(currency), Number(digits)),
      ).toEqual({ name, amount: { minor, currency } });
    },
  );
  it.each([
    ['น้ำ', 'THB', 2, 'AOK-5101'],
    ['น้ำ 0', 'THB', 2, 'AOK-5102'],
    ['น้ำ -10', 'THB', 2, 'AOK-5102'],
    ['น้ำ 1,25.00', 'THB', 2, 'AOK-5102'],
    ['น้ำ 1.001', 'THB', 2, 'AOK-5102'],
    ['น้ำ 1.0', 'JPY', 0, 'AOK-5102'],
    ['120', 'THB', 2, 'AOK-5103'],
  ])('rejects malformed trailing price %s', (text, currency, digits, code) => {
    expect(() =>
      parseExpenseText(String(text), String(currency), Number(digits)),
    ).toThrow(expect.objectContaining({ errorCode: code }));
  });
  it('always includes payer first, keeps guest selection explicit and conserves every minor unit', () => {
    const people = [
      { id: 'payer', sortOrder: 3 },
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
      { id: 'unselected', sortOrder: 4 },
    ];
    for (let total = 1; total <= 37; total++) {
      const shares = splitExpense(
        { minor: String(total), currency: 'JPY' },
        'payer',
        ['b', 'a'],
        people,
      );
      expect(shares.map((s) => s.participantId)).toEqual(['payer', 'a', 'b']);
      expect(shares.reduce((sum, s) => sum + BigInt(s.amount.minor), 0n)).toBe(
        BigInt(total),
      );
      expect(shares).toEqual(
        splitExpense(
          { minor: String(total), currency: 'JPY' },
          'payer',
          ['a', 'b'],
          people,
        ),
      );
    }
    expect(
      splitExpense({ minor: '1', currency: 'JPY' }, 'payer', [], people),
    ).toEqual([
      {
        participantId: 'payer',
        amount: { minor: '1', currency: 'JPY' },
        splitOrder: 1,
      },
    ]);
    expect(() =>
      splitExpense(
        { minor: '1', currency: 'JPY' },
        'payer',
        ['a', 'a'],
        people,
      ),
    ).toThrow(expect.objectContaining({ errorCode: 'AOK-6002' }));
  });
});
