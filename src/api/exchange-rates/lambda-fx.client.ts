import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { ApiError, ERRORS } from '../../common/api-error.filter.js';
import { rateInput } from '../../common/money.js';

export const FX_INVOKE = Symbol('FX_INVOKE');

export type FxInvoke = (
  functionName: string,
  payload: Uint8Array,
) => Promise<{ Payload?: Uint8Array; FunctionError?: string }>;

/** I/O: SDK transport แยกเพื่อ mock; default credential chain + IAM InvokeFunction ไม่มี public Function URL */
@Injectable()
export class LambdaFxTransport implements OnApplicationShutdown {
  private readonly client: LambdaClient;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.client = new LambdaClient({
      region: config.get<string>('AWS_REGION') || 'ap-southeast-1',
      maxAttempts: 1,
      requestHandler: { requestTimeout: 5000, connectionTimeout: 2000 },
    });
  }

  invoke: FxInvoke = (functionName, payload) =>
    this.client.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: payload,
      }),
      { abortSignal: AbortSignal.timeout(6000) },
    );

  onApplicationShutdown() {
    this.client.destroy();
  }
}

@Injectable()
export class LambdaFxClient {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(FX_INVOKE) private readonly invoke: FxInvoke,
  ) {}

  /** I/O: คู่สกุล → validated provider decimal/date; ไม่ส่ง upstream body/error ให้ browser */
  async rate(
    fromCurrency: string,
    toCurrency: string,
  ): Promise<{ rate: string; capturedAt: string }> {
    const name = this.config.get<string>('FX_LAMBDA_FUNCTION_NAME');
    if (!name)
      throw new ApiError(
        ERRORS.EXCHANGE_RATE_PROVIDER_UNAVAILABLE,
        'ยังไม่ได้ตั้งค่า provider อัตราแลกเปลี่ยน',
      );
    let response: Awaited<ReturnType<FxInvoke>>;
    try {
      response = await this.invoke(
        name,
        new TextEncoder().encode(JSON.stringify({ fromCurrency, toCurrency })),
      );
    } catch {
      throw new ApiError(
        ERRORS.EXCHANGE_RATE_PROVIDER_UNAVAILABLE,
        'ผู้ให้อัตราแลกเปลี่ยนไม่พร้อมใช้งาน',
      );
    }
    if (response.FunctionError)
      throw new ApiError(
        ERRORS.EXCHANGE_RATE_PROVIDER_UNAVAILABLE,
        'Lambda อัตราแลกเปลี่ยนไม่พร้อมใช้งาน',
      );
    if (!response.Payload || response.Payload.byteLength > 16384)
      throw new ApiError(
        ERRORS.EXCHANGE_RATE_PROVIDER_ERROR,
        'ผู้ให้อัตราแลกเปลี่ยนตอบข้อมูลไม่ถูกต้อง',
      );
    try {
      const body = JSON.parse(
        new TextDecoder().decode(response.Payload),
      ) as Record<string, unknown>;
      if (body.error === 'unavailable')
        throw new ApiError(
          ERRORS.EXCHANGE_RATE_PROVIDER_UNAVAILABLE,
          'ผู้ให้อัตราแลกเปลี่ยนไม่พร้อมใช้งาน',
        );
      if (body.error === 'unsupported')
        throw new ApiError(
          ERRORS.EXCHANGE_RATE_PAIR_UNSUPPORTED,
          'คู่สกุลเงินไม่รองรับ',
        );
      if (
        body.fromCurrency !== fromCurrency ||
        body.toCurrency !== toCurrency ||
        typeof body.capturedAt !== 'string'
      )
        throw new Error();
      const captured = Date.parse(body.capturedAt);
      if (
        !Number.isFinite(captured) ||
        captured > Date.now() + 60000 ||
        captured < Date.now() - 10 * 86400000
      )
        throw new Error();
      return {
        rate: rateInput(body.rate),
        capturedAt: new Date(captured).toISOString(),
      };
    } catch (error) {
      if (
        error instanceof ApiError &&
        ['AOK-7003', 'AOK-7004'].includes(error.errorCode)
      )
        throw error;
      throw new ApiError(
        ERRORS.EXCHANGE_RATE_PROVIDER_ERROR,
        'ผู้ให้อัตราแลกเปลี่ยนตอบข้อมูลไม่ถูกต้อง',
      );
    }
  }
}
