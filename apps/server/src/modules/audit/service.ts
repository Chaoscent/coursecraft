// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';

export interface AuditEvent {
  actorUserId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  /** Metadata only. Never content, passwords, tokens or AI payloads. */
  meta?: Record<string, unknown>;
  ipHmac?: string | null;
}

/** Append-only log; the app database role cannot update or delete entries. */
export class AuditService {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async record(event: AuditEvent, db: Kysely<Database> = this.#db): Promise<void> {
    await db
      .insertInto('audit_log')
      .values({
        actor_user_id: event.actorUserId,
        action: event.action,
        target_type: event.targetType ?? null,
        target_id: event.targetId ?? null,
        meta: JSON.stringify(event.meta ?? {}),
        ip_hmac: event.ipHmac ?? null,
      })
      .execute();
  }
}
