import { CurrenciesService } from '../../src/api/currencies/currencies.service.js';
import type { DatabaseService } from '../../src/database/database.service.js';
describe('currency reference metadata', () => {
  it('maps minor-unit digits from the database and rejects unsupported codes', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ code: 'JPY', symbol: '¥', minor_unit_digits: 0 }],
    });
    const currencies = new CurrenciesService({
      query,
    } as unknown as DatabaseService);
    expect(await currencies.list()).toEqual([
      { code: 'JPY', symbol: '¥', minorUnitDigits: 0 },
    ]);
    expect(await currencies.require('JPY')).toMatchObject({
      minorUnitDigits: 0,
    });
    query.mockResolvedValue({ rows: [] });
    await expect(currencies.require('ZZZ')).rejects.toMatchObject({
      errorCode: 'AOK-5201',
    });
  });
});
