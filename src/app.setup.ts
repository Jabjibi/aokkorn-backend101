import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { LineLoginConfig } from './api/line-login/line-login.config.js';
import { ApiErrorFilter } from './common/api-error.filter.js';

/** ใช้ setup เดียวกันตอนรันจริงและ HTTP tests */
export function setupApp(app: INestApplication): void {
  const config = app.get(LineLoginConfig);
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: config.origins,
    credentials: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
  });
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Trace-Id', randomUUID());
    next();
  });
  app.useGlobalFilters(new ApiErrorFilter(config.failureUrl));
  app.enableShutdownHooks();
}
