import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { LineLoginController } from './line-login.controller.js';
import { LineLoginService } from './line-login.service.js';
import { LineLoginConfig } from './line-login.config.js';
import { LineLoginCookies } from './line-login.cookies.js';
import { LineLoginRepository } from './line-login.repository.js';
import { LineClient, LINE_FETCH } from './line.client.js';
import { SessionGuard } from './session.guard.js';

/** ประกอบ feature นี้จุดเดียว; ใช้ concrete classes เพื่อให้ตามโค้ดได้ตรง ๆ */
@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }])],
  controllers: [LineLoginController],
  providers: [
    LineLoginService,
    LineLoginConfig,
    LineLoginCookies,
    LineLoginRepository,
    LineClient,
    SessionGuard,
    {
      provide: LINE_FETCH,
      useValue: (...args: Parameters<typeof fetch>) => fetch(...args),
    },
  ],
  exports: [SessionGuard, LineLoginService, LineLoginCookies, LineLoginConfig],
})
export class LineLoginModule {}
