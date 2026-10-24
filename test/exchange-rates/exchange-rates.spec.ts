import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { ExchangeRatesService } from '../../src/api/exchange-rates/exchange-rates.service.js';
import { CurrenciesService } from '../../src/api/currencies/currencies.service.js';
import { LambdaFxClient } from '../../src/api/exchange-rates/lambda-fx.client.js';
import { exchangeInput } from '../../src/api/exchange-rates/exchange.dto.js';
import { handler } from '../../lambda/exchange-rates/handler.js';
function fixture() {
  const config = new ConfigService({
    NODE_ENV: 'test',
    FX_QUOTE_SECRET: 'test-signing-key-at-least-32-bytes',
    FX_LAMBDA_FUNCTION_NAME: 'test',
  });
  const currencies = {
    require: vi.fn(async (code: string) => ({
      code,
      symbol: code,
      minorUnitDigits: code === 'JPY' ? 0 : 2,
    })),
  };
  const provider = {
    rate: vi.fn().mockResolvedValue({
      rate: '0.23',
      capturedAt: new Date().toISOString(),
    }),
  };
  return {
    config,
    provider,
    service: new ExchangeRatesService(
      config,
      currencies as unknown as CurrenciesService,
      provider as unknown as LambdaFxClient,
    ),
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('signed FX quotes and manual rates', () => {
  it('binds quote signature to actor/pair and rejects tampering and expiry', async () => {
    const f = fixture(),
      quote = await f.service.quote('owner', 'JPY', 'THB');
    expect(
      f.service.resolveRate({ quoteId: quote.quoteId }, 'owner', 'JPY', 'THB'),
    ).toMatchObject({ rate: '0.23', source: 'provider' });
    for (const [id, owner, from, to] of [
      [quote.quoteId, 'other', 'JPY', 'THB'],
      [quote.quoteId, 'owner', 'USD', 'THB'],
      [quote.quoteId + 'x', 'owner', 'JPY', 'THB'],
    ])
      expect(() =>
        f.service.resolveRate({ quoteId: id! }, owner!, from!, to!),
      ).toThrow(expect.objectContaining({ errorCode: 'AOK-7007' }));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 300001);
    expect(() =>
      f.service.resolveRate({ quoteId: quote.quoteId }, 'owner', 'JPY', 'THB'),
    ).toThrow(expect.objectContaining({ errorCode: 'AOK-7006' }));
    expect(
      f.service.resolveRate(
        { quoteId: quote.quoteId },
        'owner',
        'JPY',
        'THB',
        true,
      ),
    ).toMatchObject({ rate: '0.23' });
  });
  it('requires a persistent key in production and supports manual rates without invoking Lambda', () => {
    const f = fixture();
    expect(
      () =>
        new ExchangeRatesService(
          new ConfigService({ NODE_ENV: 'production' }),
          {} as CurrenciesService,
          {} as LambdaFxClient,
        ),
    ).toThrow('FX_QUOTE_SECRET');
    expect(
      f.service.resolveRate({ manualRate: '0.2300' }, 'owner', 'JPY', 'THB'),
    ).toMatchObject({ source: 'manual', rate: '0.23' });
    expect(f.provider.rate).not.toHaveBeenCalled();
  });
  it.each([
    { manualRate: '1', quoteId: 'x' },
    { rate: '1', source: 'provider' },
    { manualRate: 1 },
    { quoteId: '' },
  ])('rejects untrusted exchange fields %j', (value) => {
    expect(() => exchangeInput(value)).toThrow();
  });
});
describe('Lambda transport boundary', () => {
  it('fails safely when unconfigured or transport is unavailable', async () => {
    const invoke = vi.fn();
    await expect(
      new LambdaFxClient(new ConfigService({}), invoke).rate('JPY', 'THB'),
    ).rejects.toMatchObject({ errorCode: 'AOK-7003' });
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockRejectedValue(new Error('private AWS detail'));
    await expect(
      new LambdaFxClient(
        new ConfigService({ FX_LAMBDA_FUNCTION_NAME: 'fx' }),
        invoke,
      ).rate('JPY', 'THB'),
    ).rejects.toMatchObject({ errorCode: 'AOK-7003' });
  });
  it.each([
    { rate: 0.23 },
    { rate: '0.23', fromCurrency: 'USD' },
    { rate: '0.23', capturedAt: 'bad' },
    { rate: '-1' },
  ])('rejects malformed provider payload %j', (patch) => {
    const body = Object.assign(
      {
        fromCurrency: 'JPY',
        toCurrency: 'THB',
        rate: '0.23',
        capturedAt: new Date().toISOString(),
      },
      patch,
    );
    const invoke = vi.fn().mockResolvedValue({
      Payload: new TextEncoder().encode(JSON.stringify(body)),
    });
    return expect(
      new LambdaFxClient(
        new ConfigService({ FX_LAMBDA_FUNCTION_NAME: 'fx' }),
        invoke,
      ).rate('JPY', 'THB'),
    ).rejects.toMatchObject({ errorCode: 'AOK-7002' });
  });
  it('Lambda adapter preserves the original numeric decimal token and returns only pair/rate/date', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          '{"base":"JPY","quote":"THB","rate":0.230000000000001,"date":"2026-10-23"}',
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    expect(await handler({ fromCurrency: 'JPY', toCurrency: 'THB' })).toEqual({
      fromCurrency: 'JPY',
      toCurrency: 'THB',
      rate: '0.230000000000001',
      capturedAt: '2026-10-23T00:00:00.000Z',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.frankfurter.dev/v2/rate/jpy/thb',
      expect.any(Object),
    );
  });
  it('Lambda adapter maps a provider outage without leaking the response', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('private-provider-body', { status: 503 }),
        ),
    );
    expect(await handler({ fromCurrency: 'JPY', toCurrency: 'THB' })).toEqual({
      error: 'unavailable',
    });
  });
});
