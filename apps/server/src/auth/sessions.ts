// SPDX-License-Identifier: Apache-2.0
import type { Role } from '@lernwerk/shared';
import type { Kysely } from 'kysely';
import { hashToken, hmac, randomToken } from '../crypto/tokens.js';
import type { Database } from '../db/schema.js';

export const SESSION_COOKIE = '__Host-lw_session';

/** `last_seen_at` and the idle expiry are written at most this often. */
const TOUCH_INTERVAL_MS = 60_000;

export interface SessionPolicy {
  idleMinutes: number;
  absoluteHours: number;
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  locale: 'de' | 'en';
  roles: Role[];
  mustChangePassword: boolean;
  totpEnabled: boolean;
  absoluteExpiresAt: Date;
  /** Set when the token was rotated during resolution; the cookie must be replaced. */
  rotatedToken?: string;
}

export interface ClientMeta {
  ipHmac: string | null;
  userAgent: string | null;
}

/**
 * Server-side sessions: opaque random tokens, only their SHA-256 hash is
 * stored. Every request resolves the session against the database together
 * with the user's current status and roles.
 */
export class SessionService {
  readonly #db: Kysely<Database>;
  readonly #policy: SessionPolicy;
  readonly #csrfKey: Buffer;
  readonly #now: () => Date;

  constructor(
    db: Kysely<Database>,
    policy: SessionPolicy,
    csrfKey: Buffer,
    now: () => Date = () => new Date(),
  ) {
    this.#db = db;
    this.#policy = policy;
    this.#csrfKey = csrfKey;
    this.#now = now;
  }

  async create(userId: string, meta: ClientMeta): Promise<{ token: string; sessionId: string }> {
    const token = randomToken();
    const now = this.#now();
    const row = await this.#db
      .insertInto('sessions')
      .values({
        token_hash: hashToken(token),
        user_id: userId,
        last_seen_at: now,
        idle_expires_at: this.#idleExpiry(now),
        absolute_expires_at: new Date(now.getTime() + this.#policy.absoluteHours * 3_600_000),
        ip_hmac: meta.ipHmac,
        user_agent: meta.userAgent?.slice(0, 512) ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { token, sessionId: row.id };
  }

  async resolve(token: string): Promise<ResolvedSession | null> {
    if (token.length !== 43) return null;
    const now = this.#now();
    const row = await this.#db
      .selectFrom('sessions')
      .innerJoin('users', 'users.id', 'sessions.user_id')
      .select([
        'sessions.id as sessionId',
        'sessions.user_id as userId',
        'sessions.idle_expires_at as idleExpiresAt',
        'sessions.absolute_expires_at as absoluteExpiresAt',
        'sessions.last_seen_at as lastSeenAt',
        'sessions.rotate_pending as rotatePending',
        'users.email',
        'users.display_name as displayName',
        'users.locale',
        'users.status',
        'users.deleted_at as deletedAt',
        'users.must_change_password as mustChangePassword',
        'users.totp_last_step as totpLastStep',
      ])
      .where('sessions.token_hash', '=', hashToken(token))
      .executeTakeFirst();
    if (!row) return null;

    if (
      row.idleExpiresAt <= now ||
      row.absoluteExpiresAt <= now ||
      row.status !== 'active' ||
      row.deletedAt
    ) {
      await this.revoke(row.sessionId);
      return null;
    }

    const roles = await this.#db
      .selectFrom('user_roles')
      .select('role')
      .where('user_id', '=', row.userId)
      .execute();

    let rotatedToken: string | undefined;
    if (row.rotatePending) {
      rotatedToken = randomToken();
      await this.#db
        .updateTable('sessions')
        .set({
          token_hash: hashToken(rotatedToken),
          rotate_pending: false,
          last_seen_at: now,
          idle_expires_at: this.#idleExpiry(now),
        })
        .where('id', '=', row.sessionId)
        .execute();
    } else if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.#db
        .updateTable('sessions')
        .set({ last_seen_at: now, idle_expires_at: this.#idleExpiry(now) })
        .where('id', '=', row.sessionId)
        .execute();
    }

    return {
      sessionId: row.sessionId,
      userId: row.userId,
      email: row.email,
      displayName: row.displayName,
      locale: row.locale,
      roles: roles.map((r) => r.role),
      mustChangePassword: row.mustChangePassword,
      totpEnabled: row.totpLastStep !== null,
      absoluteExpiresAt: row.absoluteExpiresAt,
      ...(rotatedToken ? { rotatedToken } : {}),
    };
  }

  /** Issues a new token for an existing session (privilege change of the session owner). */
  async rotate(sessionId: string): Promise<string> {
    const token = randomToken();
    await this.#db
      .updateTable('sessions')
      .set({ token_hash: hashToken(token), rotate_pending: false })
      .where('id', '=', sessionId)
      .execute();
    return token;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.#db.deleteFrom('sessions').where('id', '=', sessionId).execute();
  }

  async revokeAll(userId: string, exceptSessionId?: string): Promise<number> {
    let query = this.#db.deleteFrom('sessions').where('user_id', '=', userId);
    if (exceptSessionId) query = query.where('id', '!=', exceptSessionId);
    const result = await query.executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  /** The user's privileges changed: every session gets a new token on its next request. */
  async markRotate(userId: string): Promise<void> {
    await this.#db
      .updateTable('sessions')
      .set({ rotate_pending: true })
      .where('user_id', '=', userId)
      .execute();
  }

  async deleteExpired(): Promise<number> {
    const now = this.#now();
    const result = await this.#db
      .deleteFrom('sessions')
      .where((eb) => eb.or([eb('idle_expires_at', '<=', now), eb('absolute_expires_at', '<=', now)]))
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  /** CSRF token bound to the session id; unforgeable without the server key. */
  csrfToken(sessionId: string): string {
    return hmac(this.#csrfKey, `csrf:${sessionId}`);
  }

  cookieMaxAgeSeconds(): number {
    return this.#policy.absoluteHours * 3600;
  }

  #idleExpiry(from: Date): Date {
    return new Date(from.getTime() + this.#policy.idleMinutes * 60_000);
  }
}
