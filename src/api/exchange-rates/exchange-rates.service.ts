import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError, ERRORS } from '../../common/api-error.filter.js';
import { convertMinor, rateInput, type Money } from '../../common/money.js';
import {
  CurrenciesService,
  type Currency,
} from '../currencies/currencies.service.js';
import { LambdaFxClient } from './lambda-fx.client.js';
import type { ExchangeSelection, FxSnapshot } from './exchange.dto.js';

type Quote = {
  ownerId: string;
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  capturedAt: string;
  expiresAt: string;
};

@Injectable()
export class ExchangeRatesService {
  private readonly key: Buffer;

  constructor(
    @Inject(ConfigService) config: ConfigService,
    @Inject(CurrenciesService) private readonly currencies: CurrenciesService,
    @Inject(LambdaFxClient) private readonly provider: LambdaFxClient,
  ) {
    const key = config.get<string>('FX_QUOTE_SECRET');
    if (
      (key && Buffer.byteLength(key) < 32) ||
      (!key && config.get('NODE_ENV') === 'production')
    )
      throw new Error('ตั้งค่า FX_QUOTE_SECRET อย่างน้อย 32 bytes');
    this.key = key ? Buffer.from(key) : randomBytes(32);
  }

  /** I/O: actor/pair → signed quote อายุ 5 นาที; quote ไม่มีสิทธิ์ใช้ข้าม user/คู่สกุล */
  async quote(ownerId: string, from: string, to: string) {
    await this.currencies.require(from, ERRORS.EXCHANGE_RATE_PAIR_UNSUPPORTED);
    await this.currencies.require(to, ERRORS.EXCHANGE_RATE_PAIR_UNSUPPORTED);
    if (from === to)
      throw new ApiError(
        ERRORS.EXCHANGE_RATE_PAIR_UNSUPPORTED,
        'ไม่ต้องใช้อัตราสำหรับสกุลเดียวกัน',
      );
    const value = await this.provider.rate(from, to);
    const quote: Quote = {
      ownerId,
      fromCurrency: from,
      toCurrency: to,
      ...value,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    };
    const payload = Buffer.from(JSON.stringify(quote)).toString('base64url');
    const quoteId = `${payload}.${this.sign(payload).toString('base64url')}`;
    return {
      quoteId,
      fromCurrency: from,
      toCurrency: to,
      ...value,
      source: 'provider' as const,
      expiresAt: quote.expiresAt,
    };
  }

  private sign(payload: string): Buffer {
    return createHmac('sha256', this.key).update(payload).digest();
  }

  /** Pure ยกเว้น clock: selection/actor/pair → rate metadata; ไม่เรียก provider ระหว่างบันทึก */
  resolveRate(
    selection: ExchangeSelection | undefined,
    ownerId: string,
    from: string,
    to: string,
    allowExpired = false,
  ): Pick<FxSnapshot, 'rate' | 'source' | 'capturedAt'> {
    if (!selection)
      throw new ApiError(
        ERRORS.EXCHANGE_RATE_REQUIRED,
        'กรุณาระบุอัตราแลกเปลี่ยน',
      );
    if ('manualRate' in selection)
      return {
        rate: rateInput(selection.manualRate),
        source: 'manual',
        capturedAt: new Date().toISOString(),
      };
    try {
      const parts = selection.quoteId.split('.');
      if (parts.length !== 2) throw new Error();
      const expected = this.sign(parts[0]!);
      const signature = Buffer.from(parts[1]!, 'base64url');
      if (
        signature.length !== expected.length ||
        !timingSafeEqual(signature, expected)
      )
        throw new Error();
      const q = JSON.parse(
        Buffer.from(parts[0]!, 'base64url').toString(),
      ) as Quote;
      if (
        q.ownerId !== ownerId ||
        q.fromCurrency !== from ||
        q.toCurrency !== to
      )
        throw new Error();
      if (
        !Number.isFinite(Date.parse(q.expiresAt)) ||
        !Number.isFinite(Date.parse(q.capturedAt))
      )
        throw new Error();
      if (!allowExpired && Date.parse(q.expiresAt) <= Date.now())
        throw new ApiError(
          ERRORS.EXCHANGE_RATE_QUOTE_EXPIRED,
          'อัตราที่เลือกหมดอายุ กรุณาขอใหม่',
        );
      return {
        rate: rateInput(q.rate),
        source: 'provider',
        capturedAt: q.capturedAt,
      };
    } catch (error) {
      if (error instanceof ApiError && error.errorCode === 'AOK-7006')
        throw error;
      throw new ApiError(
        ERRORS.EXCHANGE_RATE_QUOTE_MISMATCH,
        'อัตราไม่ตรงกับผู้ใช้หรือคู่สกุลเงินนี้',
      );
    }
  }

  /** Pure ยกเว้น resolve clock: Money + currencies + selection → snapshot/ไม่มี FX สำหรับสกุลเดียวกัน */
  snapshot(
    amount: Money,
    from: Currency,
    to: Currency,
    selection: ExchangeSelection | undefined,
    ownerId: string,
  ): FxSnapshot | null {
    if (from.code === to.code) {
      if (selection)
        throw new ApiError(
          ERRORS.EXCHANGE_RATE_QUOTE_MISMATCH,
          'ไม่ต้องใช้อัตราสำหรับสกุลเดียวกัน',
        );
      return null;
    }
    const rate = this.resolveRate(selection, ownerId, from.code, to.code);
    return {
      fromCurrency: from.code,
      toCurrency: to.code,
      ...rate,
      converted: {
        minor: convertMinor(
          amount.minor,
          rate.rate,
          from.minorUnitDigits,
          to.minorUnitDigits,
        ),
        currency: to.code,
      },
    };
  }
}
