import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Pool เดียวทั้งแอป: ไม่ผูกกับ feature login และไม่สร้างตาราง/seed ตอน boot */
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly pool?: Pool;
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@Inject(ConfigService) config: ConfigService) {
    const connection = config.get<string>('DATABASE_URL')?.trim();
    if (!connection) return;
    let url: URL;
    try {
      url = new URL(connection);
      if (
        !['postgres:', 'postgresql:'].includes(url.protocol) ||
        !url.hostname ||
        url.pathname.length < 2
      )
        throw new Error();
    } catch {
      // URL parser อาจแนบ input ใน error; ห้ามให้ credentials หลุดออก startup log
      throw new Error('ตั้งค่า DATABASE_URL ไม่ถูกต้อง');
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const mode = url.searchParams.get('sslmode');
    if (!local && mode && mode !== 'verify-full')
      throw new Error(
        'DATABASE_URL ต้องใช้ sslmode=verify-full หรือไม่ระบุ sslmode',
      );
    for (const key of [
      'ssl',
      'sslmode',
      'sslcert',
      'sslkey',
      'sslrootcert',
      'uselibpqcompat',
    ])
      url.searchParams.delete(key);
    const caPath = config.get<string>('DATABASE_CA_CERT_PATH')?.trim();
    this.pool = new Pool({
      connectionString: url.href,
      ssl:
        local && config.get('NODE_ENV') !== 'production'
          ? false
          : {
              rejectUnauthorized: true,
              ...(caPath ? { ca: readFileSync(resolve(caPath), 'utf8') } : {}),
            },
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 5000,
      query_timeout: 5000,
    });
    this.pool.on('error', () =>
      this.logger.error('database_pool_connection_failed'),
    );
  }

  /** I/O: parameterized SQL → pg result; ผู้เรียกไม่ต้องจัดการ connection สำหรับ query เดี่ยว */
  query<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
    return this.database().query<T>(sql, values);
  }

  /** I/O: callback → ผลลัพธ์; rollback เมื่อผิดพลาด และ release/discard ทุกเส้นทาง */
  async transaction<T>(
    work: (client: PoolClient) => Promise<T>,
    readOnly = false,
  ): Promise<T> {
    let client: PoolClient | undefined;
    let discard = false;
    try {
      client = await this.database().connect();
      await client.query(
        readOnly
          ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'
          : 'BEGIN ISOLATION LEVEL READ COMMITTED',
      );
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discard = true;
        }
      }
      throw error;
    } finally {
      client?.release(discard);
    }
  }

  private database(): Pool {
    if (!this.pool) throw new Error('database_not_configured');
    return this.pool;
  }

  async onApplicationShutdown() {
    await this.pool?.end();
  }
}
