import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LineLoginConfig } from './line-login.config.js';
import type { LineIdentity } from './line.client.js';

export interface AuthUser {
  id: string;
  displayName: string;
}
export interface StoredSession {
  user: AuthUser;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** SQL ของ users/sessions อยู่ไฟล์นี้; ไม่มีการสร้างตารางหรือ seed ตอน boot */
@Injectable()
export class LineLoginRepository implements OnApplicationShutdown {
  private readonly pool?: Pool;
  private readonly logger = new Logger(LineLoginRepository.name);

  constructor(@Inject(LineLoginConfig) config: LineLoginConfig) {
    if (!config.enabled) return;
    const url = new URL(config.databaseUrl);
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
    this.pool = new Pool({
      connectionString: url.href,
      ssl:
        local && !config.production
          ? false
          : {
              rejectUnauthorized: true,
              ...(config.databaseCaPath
                ? { ca: readFileSync(resolve(config.databaseCaPath), 'utf8') }
                : {}),
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

  async createSession(
    identity: LineIdentity,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    let client: PoolClient | undefined;
    let discard = false;
    try {
      client = await this.database().connect();
      await client.query('BEGIN');
      const result = await client.query<{ id: string }>(
        `INSERT INTO public.users(line_subject, display_name) VALUES ($1, $2)
         ON CONFLICT(line_subject) DO UPDATE SET display_name=EXCLUDED.display_name, updated_at=now()
         RETURNING id`,
        [identity.subject, identity.displayName],
      );
      await client.query(
        'INSERT INTO public.sessions(user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [result.rows[0]!.id, tokenHash, expiresAt],
      );
      await client.query('COMMIT');
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discard = true;
        }
      }
      // Filter ซ่อน SQL/connection details; log เฉพาะ event ไม่ส่ง credentials ออกไป
      throw error;
    } finally {
      client?.release(discard);
    }
  }

  async findSession(tokenHash: string): Promise<StoredSession | null> {
    const result = await this.database().query<{
      id: string;
      display_name: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT u.id, u.display_name, s.expires_at, s.revoked_at FROM public.sessions s
       JOIN public.users u ON u.id=s.user_id WHERE s.token_hash=$1`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row
      ? {
          user: { id: row.id, displayName: row.display_name },
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
        }
      : null;
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.database().query(
      'UPDATE public.sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',
      [tokenHash],
    );
  }

  private database(): Pool {
    if (!this.pool) throw new Error('database_not_configured');
    return this.pool;
  }

  async onApplicationShutdown() {
    await this.pool?.end();
  }
}
