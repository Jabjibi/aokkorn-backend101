import {
  settlementInput,
  settlementPreviewInput,
} from '../../src/api/obligations/obligations.dto.js';
describe('settlement input contract', () => {
  it('accepts actual paid money and manual selection without allowing client status/date', () => {
    const input = {
      paidAmount: { minor: '11600', currency: 'THB' },
      exchange: { manualRate: '0.23' },
    };
    expect(settlementInput(input)).toEqual(input);
    expect(
      settlementPreviewInput({
        currency: 'THB',
        exchange: { manualRate: '0.23' },
      }),
    ).toEqual({ currency: 'THB', exchange: { manualRate: '0.23' } });
    expect(() => settlementInput({ ...input, status: 'paid' })).toThrow();
    expect(() => settlementInput({ ...input, paidAt: '2026-01-01' })).toThrow();
  });
  it('rejects zero payment and extra fields in nested Money', () => {
    expect(() =>
      settlementInput({ paidAmount: { minor: '0', currency: 'THB' } }),
    ).toThrow(expect.objectContaining({ errorCode: 'AOK-8101' }));
    expect(() =>
      settlementInput({
        paidAmount: { minor: '1', currency: 'THB', converted: '5' },
      }),
    ).toThrow(expect.objectContaining({ errorCode: 'AOK-9001' }));
  });
});
