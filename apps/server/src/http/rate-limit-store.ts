// SPDX-License-Identifier: Apache-2.0
import type { FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';

type Callback = (error: Error | null, result?: { current: number; ttl: number }) => void;

/** The route a store instance counts for (`routeInfo` in the plugin's merged options). */
function routeOf(options: unknown): string {
  const holder = (options ?? {}) as {
    routeInfo?: { method?: unknown; url?: unknown };
    method?: unknown;
    url?: unknown;
  };
  const info = holder.routeInfo ?? holder;
  const method = Array.isArray(info.method)
    ? info.method.join(',')
    : typeof info.method === 'string'
      ? info.method
      : '';
  return `${method} ${typeof info.url === 'string' ? info.url : ''}|`;
}

/**
 * Counters in the database for `@fastify/rate-limit`, so several replicas
 * share one limit per client (the default store lives in each process). One
 * atomic upsert per limited request; only sign-in style routes are limited.
 */
export function databaseRateLimitStore(db: Kysely<Database>): FastifyRateLimitStoreCtor {
  return class DatabaseStore {
    readonly #prefix: string;

    constructor(options?: unknown) {
      this.#prefix = routeOf(options);
    }

    child(options: unknown): DatabaseStore {
      return new DatabaseStore(options);
    }

    incr(key: string, callback: Callback, timeWindow: number): void {
      const now = new Date();
      const resetAt = new Date(now.getTime() + timeWindow);
      db.insertInto('rate_limits')
        .values({ key: this.#prefix + key, count: 1, reset_at: resetAt })
        .onConflict((oc) =>
          oc.column('key').doUpdateSet((eb) => ({
            count: eb
              .case()
              .when('rate_limits.reset_at', '<=', now)
              .then(1)
              .else(eb('rate_limits.count', '+', 1))
              .end(),
            reset_at: eb
              .case()
              .when('rate_limits.reset_at', '<=', now)
              .then(resetAt)
              .else(eb.ref('rate_limits.reset_at'))
              .end(),
          })),
        )
        .returning(['count', 'reset_at'])
        .executeTakeFirstOrThrow()
        .then(
          (row) =>
            callback(null, { current: row.count, ttl: Math.max(0, row.reset_at.getTime() - Date.now()) }),
          (error: unknown) =>
            callback(error instanceof Error ? error : new Error('rate limit store failed'), {
              current: 0,
              ttl: 0,
            }),
        );
    }

    read(key: string, callback: Callback): void {
      db.selectFrom('rate_limits')
        .select(['count', 'reset_at'])
        .where('key', '=', this.#prefix + key)
        .executeTakeFirst()
        .then(
          (row) =>
            callback(null, {
              current: row && row.reset_at > new Date() ? row.count : 0,
              ttl: row ? Math.max(0, row.reset_at.getTime() - Date.now()) : 0,
            }),
          (error: unknown) =>
            callback(error instanceof Error ? error : new Error('rate limit store failed'), {
              current: 0,
              ttl: 0,
            }),
        );
    }
  };
}

/** Counters of finished windows are of no use; keep the table small. */
export async function purgeRateLimits(db: Kysely<Database>): Promise<number> {
  const result = await db
    .deleteFrom('rate_limits')
    .where('reset_at', '<', new Date(Date.now() - 3_600_000))
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
