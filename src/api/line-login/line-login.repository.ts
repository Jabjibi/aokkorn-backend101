import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
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

/** SQL users/sessions เท่านั้น; ใช้ pool และ transaction กลางร่วมกับ feature อื่น */
@Injectable()
export class LineLoginRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async createSession(
    identity: LineIdentity,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO public.users(line_subject, display_name) VALUES ($1, $2)
         ON CONFLICT(line_subject) DO UPDATE SET display_name=EXCLUDED.display_name, updated_at=now() RETURNING id`,
        [identity.subject, identity.displayName],
      );
      await client.query(
        'INSERT INTO public.sessions(user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [result.rows[0]!.id, tokenHash, expiresAt],
      );
    });
  }

  async findSession(tokenHash: string): Promise<StoredSession | null> {
    const result = await this.database.query<{
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
    await this.database.query(
      'UPDATE public.sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',
      [tokenHash],
    );
  }
}
