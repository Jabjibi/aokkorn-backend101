import 'reflect-metadata';
import type { ArgumentsHost } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiError,
  ApiErrorFilter,
  ERRORS,
} from '../src/common/api-error.filter.js';
import { LineLoginConfig } from '../src/api/line-login/line-login.config.js';

const failureUrl = 'http://localhost:3000/?login=failed';
function fixture(
  path: string,
  configured: string | undefined = failureUrl,
  method = 'GET',
) {
  const response = {
    headersSent: false,
    getHeader: vi.fn().mockReturnValue('trace-test'),
    setHeader: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
    redirect: vi.fn(),
  };
  response.status.mockReturnValue(response);
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ path, method }),
    }),
  } as unknown as ArgumentsHost;
  const filter = new ApiErrorFilter(configured);
  return { response, host, filter };
}
beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('browser OAuth errors กลับ frontend โดยไม่เปิด server', () => {
  it.each([
    '/api/v1/auth/line/start',
    '/api/v1/auth/line/callback',
    '/api/v1/auth/line/callback/',
  ])('GET %s redirect ไป URL ที่ตั้งค่าเท่านั้น', (path) => {
    const f = fixture(path);
    f.filter.catch(
      new ApiError(ERRORS.LINE_CALLBACK_INVALID, 'private-error-detail'),
      f.host,
    );
    expect(f.response.redirect).toHaveBeenCalledWith(303, failureUrl);
    expect(f.response.json).not.toHaveBeenCalled();
  });
  it.each(['/api/v1/auth/me', '/api/v1/auth/logout'])(
    '%s ยังคง JSON contract สำหรับ fetch',
    (path) => {
      const f = fixture(path);
      f.filter.catch(
        new ApiError(ERRORS.SESSION_MISSING, 'กรุณาเข้าสู่ระบบ'),
        f.host,
      );
      expect(f.response.redirect).not.toHaveBeenCalled();
      expect(f.response.status).toHaveBeenCalledWith(401);
      expect(f.response.json).toHaveBeenCalledWith(
        expect.objectContaining({ errorCode: 'AOK-1001' }),
      );
    },
  );
  it('API แบบไม่ตั้ง failure URL ยังคงส่ง JSON เดิม', () => {
    const f = fixture('/api/v1/auth/line/callback', '');
    f.filter.catch(
      new ApiError(ERRORS.LINE_CALLBACK_INVALID, 'คำขอไม่ถูกต้อง'),
      f.host,
    );
    expect(f.response.redirect).not.toHaveBeenCalled();
    expect(f.response.status).toHaveBeenCalledWith(400);
  });
  it('ไม่ redirect POST หรือ routes อื่น', () => {
    const f = fixture('/api/v1/auth/line/start', failureUrl, 'POST');
    f.filter.catch(new Error('private'), f.host);
    expect(f.response.redirect).not.toHaveBeenCalled();
    expect(f.response.status).toHaveBeenCalledWith(500);
  });
  it('reject failure URL นอก allowed origins ก่อนเริ่มแอป', () => {
    expect(
      () =>
        new LineLoginConfig(
          new ConfigService({
            LOGIN_FAILURE_URL: 'https://untrusted.example/',
          }),
        ),
    ).toThrow('LOGIN_FAILURE_URL');
  });
});
