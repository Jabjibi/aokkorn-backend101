import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

// สัญญา error ของ frontend: เลือกรหัสจากรายการนี้ ไม่ส่งรายละเอียด LINE/SQL ออกไป
export const ERRORS = {
  SESSION_MISSING: [401, 'AOK-1001'],
  SESSION_EXPIRED: [401, 'AOK-1002'],
  SESSION_REVOKED: [401, 'AOK-1003'],
  LINE_CALLBACK_INVALID: [400, 'AOK-1101'],
  LINE_PROVIDER_ERROR: [502, 'AOK-1102'],
  LINE_PROVIDER_UNAVAILABLE: [503, 'AOK-1103'],
  CSRF_INVALID: [403, 'AOK-1201'],
  TRIP_NOT_FOUND: [404, 'AOK-2001'],
  TRIP_LIMIT_EXCEEDED: [409, 'AOK-2101'],
  TRIP_NAME_REQUIRED: [400, 'AOK-2201'],
  TRIP_BASE_CURRENCY_UNSUPPORTED: [400, 'AOK-2202'],
  TRIP_RESTORE_LIMIT_EXCEEDED: [409, 'AOK-2102'],
  TRIP_RESTORE_WINDOW_EXPIRED: [409, 'AOK-2103'],
  TRIP_ALREADY_DELETED: [409, 'AOK-2104'],
  TRIP_BASE_CURRENCY_RATE_REQUIRED: [400, 'AOK-2203'],
  TRIP_BASE_CURRENCY_CONVERSION_INVALID: [400, 'AOK-2204'],
  PARTICIPANT_NOT_FOUND: [404, 'AOK-3001'],
  PARTICIPANT_NAME_REQUIRED: [400, 'AOK-3101'],
  PARTICIPANT_NAME_TOO_LONG: [400, 'AOK-3102'],
  PARTICIPANT_HAS_REFERENCES: [409, 'AOK-3201'],
  PARTICIPANT_OWNER_CANNOT_BE_DELETED: [409, 'AOK-3202'],
  TRIP_DAY_NOT_FOUND: [404, 'AOK-4001'],
  TRIP_DAY_NAME_REQUIRED: [400, 'AOK-4101'],
  TRIP_DAY_ORDER_CONFLICT: [409, 'AOK-4102'],
  EXPENSE_NOT_FOUND: [404, 'AOK-5001'],
  EXPENSE_AMOUNT_NOT_FOUND: [422, 'AOK-5101'],
  EXPENSE_AMOUNT_INVALID: [400, 'AOK-5102'],
  EXPENSE_NAME_REQUIRED: [400, 'AOK-5103'],
  EXPENSE_NAME_TOO_LONG: [400, 'AOK-5104'],
  EXPENSE_CURRENCY_UNSUPPORTED: [400, 'AOK-5201'],
  EXPENSE_PAYER_REQUIRED: [400, 'AOK-5301'],
  EXPENSE_PAYER_NOT_IN_TRIP: [400, 'AOK-5302'],
  EXPENSE_PAID_OBLIGATION_LOCKED: [409, 'AOK-5401'],
  SHARE_PARTICIPANT_NOT_IN_TRIP: [400, 'AOK-6001'],
  SHARE_DUPLICATE_PARTICIPANT: [400, 'AOK-6002'],
  SHARE_ROUNDING_INVARIANT_VIOLATED: [500, 'AOK-6501'],
  EXCHANGE_RATE_INVALID: [400, 'AOK-7001'],
  EXCHANGE_RATE_PROVIDER_ERROR: [502, 'AOK-7002'],
  EXCHANGE_RATE_PROVIDER_UNAVAILABLE: [503, 'AOK-7003'],
  EXCHANGE_RATE_PAIR_UNSUPPORTED: [400, 'AOK-7004'],
  EXCHANGE_RATE_REQUIRED: [400, 'AOK-7005'],
  EXCHANGE_RATE_QUOTE_EXPIRED: [409, 'AOK-7006'],
  EXCHANGE_RATE_QUOTE_MISMATCH: [400, 'AOK-7007'],
  OBLIGATION_NOT_FOUND: [404, 'AOK-8001'],
  SETTLEMENT_PAID_AMOUNT_INVALID: [400, 'AOK-8101'],
  SETTLEMENT_CURRENCY_UNSUPPORTED: [400, 'AOK-8102'],
  SETTLEMENT_EXCHANGE_RATE_REQUIRED: [400, 'AOK-8103'],
  SETTLEMENT_ALREADY_PAID_DIFFERENT: [409, 'AOK-8104'],
  HEALTH_UNAVAILABLE: [503, 'AOK-9000'],
  INTERNAL_ERROR: [500, 'AOK-9000'],
  VALIDATION_FAILED: [400, 'AOK-9001'],
  RATE_LIMITED: [429, 'AOK-9002'],
} as const;

export class ApiError extends HttpException {
  readonly errorCode: string;

  constructor(
    error: (typeof ERRORS)[keyof typeof ERRORS],
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message, error[0]);
    this.errorCode = error[1];
  }
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  constructor(private readonly loginFailureUrl?: string) {}

  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;
    const statusCode = error instanceof HttpException ? error.getStatus() : 500;
    const errorCode =
      error instanceof ApiError
        ? error.errorCode
        : statusCode === 429
          ? ERRORS.RATE_LIMITED[1]
          : statusCode === 400
            ? ERRORS.VALIDATION_FAILED[1]
            : ERRORS.INTERNAL_ERROR[1];
    const traceId = String(response.getHeader('X-Trace-Id') ?? randomUUID());
    // OAuth code อยู่ใน URL จึง log เฉพาะข้อมูลนี้ ไม่ log request/exception ดิบ
    const request = host.switchToHttp().getRequest<Request>();
    const method = request.method;
    this.logger.warn({ traceId, errorCode, method });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Trace-Id', traceId);
    const path = request.path.replace(/\/$/, '');
    if (
      this.loginFailureUrl &&
      method === 'GET' &&
      ['/api/v1/auth/line/start', '/api/v1/auth/line/callback'].includes(path)
    ) {
      // Browser OAuth กลับหน้าเดิมพร้อมข้อความทั่วไป; me/logout ยังคง JSON contract
      response.redirect(303, this.loginFailureUrl);
      return;
    }
    response.status(statusCode).json({
      statusCode,
      errorCode,
      message:
        error instanceof ApiError
          ? error.message
          : 'ไม่สามารถทำรายการได้ กรุณาลองใหม่',
      details: error instanceof ApiError ? error.details : {},
      traceId,
    });
  }
}
