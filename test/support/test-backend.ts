import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { PoolClient } from 'pg';
import { AppModule } from '../../src/app.module.js';
import { DatabaseService } from '../../src/database/database.service.js';
import {
  FX_INVOKE,
  type FxInvoke,
} from '../../src/api/exchange-rates/lambda-fx.client.js';
/** PostgreSQL WASM แบบ in-memory: ไม่มี port/server/network และไม่อ่าน .env จริง */
export async function testBackend() {
  const pg = new PGlite();
  await pg.exec(
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;',
  );
  await pg.exec(
    await readFile(new URL('../fixtures/schema.sql', import.meta.url), 'utf8'),
  );
  await pg.exec(
    `INSERT INTO public.currencies(code,symbol,minor_unit_digits) VALUES('THB','฿',2),('JPY','¥',0),('USD','$',2),('VND','₫',0);`,
  );
  const database = {
    query: <T>(sql: string, values: unknown[] = []) => pg.query<T>(sql, values),
    transaction: <T>(
      work: (client: PoolClient) => Promise<T>,
      readOnly = false,
    ) =>
      pg.transaction(async (tx) => {
        await tx.exec(
          readOnly
            ? 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'
            : 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
        );
        const client = {
          query: <R>(sql: string, values: unknown[] = []) =>
            tx.query<R>(sql, values),
        } as unknown as PoolClient;
        return work(client);
      }),
    onApplicationShutdown: () => pg.close(),
  };
  const invoke = vi
    .fn<FxInvoke>()
    .mockImplementation(async (_function, payload) => {
      const { fromCurrency, toCurrency } = JSON.parse(
        new TextDecoder().decode(payload),
      );
      return {
        Payload: new TextEncoder().encode(
          JSON.stringify({
            fromCurrency,
            toCurrency,
            rate: '0.23',
            capturedAt: new Date().toISOString(),
          }),
        ),
      };
    });
  const config = new ConfigService({
    NODE_ENV: 'test',
    LINE_LOGIN_ENABLED: 'false',
    FX_LAMBDA_FUNCTION_NAME: 'test-function',
    FX_QUOTE_SECRET: 'test-only-signing-secret-32-bytes-long',
  });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(DatabaseService)
    .useValue(database)
    .overrideProvider(FX_INVOKE)
    .useValue(invoke)
    .compile();
  return {
    module,
    pg,
    invoke,
    reset: () => pg.exec('TRUNCATE public.users CASCADE;'),
    close: () => module.close(),
    user: async (subject = 'owner') => {
      const result = await pg.query<{ id: string }>(
        `INSERT INTO public.users(line_subject,display_name) VALUES($1,$2) RETURNING id`,
        [subject, subject],
      );
      return result.rows[0]!.id;
    },
  };
}
