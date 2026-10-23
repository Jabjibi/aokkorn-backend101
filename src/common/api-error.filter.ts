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
  INTERNAL_ERROR: [500, 'AOK-9000'],
  VALIDATION_FAILED: [400, 'AOK-9001'],
  RATE_LIMITED: [429, 'AOK-9002'],
} as const;

export class ApiError extends HttpException {
  readonly errorCode: string;
  constructor(error: (typeof ERRORS)[keyof typeof ERRORS], message: string) {
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
      details: {},
      traceId,
    });
  }
}
