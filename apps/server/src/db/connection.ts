// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from 'node:crypto';
import {
  Kysely,
  PostgresDialect,
  type DatabaseConnection,
  type Driver,
  type TransactionSettings,
} from 'kysely';
import pg from 'pg';
import { currentScope, DEFAULT_TENANT_ID } from '../tenancy/context.js';
import { setTenantQuery } from './migrations/sql-helpers.js';
import type { Database } from './schema.js';

/**
 * - `off`: no tenant (the migrator, which owns the tables and is not subject to row-level security).
 * - `single`: the default tenant unless a scope says otherwise.
 * - `multi`: the scope decides; without one, queries on tenant tables fail.
 */
export type Tenancy = 'off' | 'single' | 'multi';

/** Tells PostgreSQL the tenant before a pooled connection is used, only when it changes. */
class TenantDriver implements Driver {
  readonly #inner: Driver;
  readonly #tenancy: Exclude<Tenancy, 'off'>;
  readonly #current = new WeakMap<DatabaseConnection, string>();

  constructor(inner: Driver, tenancy: Exclude<Tenancy, 'off'>) {
    this.#inner = inner;
    this.#tenancy = tenancy;
  }

  init(): Promise<void> {
    return this.#inner.init();
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    const connection = await this.#inner.acquireConnection();
    // An empty tenant makes every policy fail loudly instead of matching nothing silently.
    const wanted = currentScope()?.id ?? (this.#tenancy === 'single' ? DEFAULT_TENANT_ID : '');
    if (this.#current.get(connection) !== wanted) {
      try {
        await connection.executeQuery(setTenantQuery(wanted));
      } catch (error) {
        await this.#inner.releaseConnection(connection);
        throw error;
      }
      this.#current.set(connection, wanted);
    }
    return connection;
  }

  beginTransaction(connection: DatabaseConnection, settings: TransactionSettings): Promise<void> {
    return this.#inner.beginTransaction(connection, settings);
  }

  commitTransaction(connection: DatabaseConnection): Promise<void> {
    return this.#inner.commitTransaction(connection);
  }

  rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    return this.#inner.rollbackTransaction(connection);
  }

  releaseConnection(connection: DatabaseConnection): Promise<void> {
    return this.#inner.releaseConnection(connection);
  }

  destroy(): Promise<void> {
    return this.#inner.destroy();
  }
}

class TenantDialect extends PostgresDialect {
  readonly #tenancy: Exclude<Tenancy, 'off'>;

  constructor(pool: pg.Pool, tenancy: Exclude<Tenancy, 'off'>) {
    super({ pool });
    this.#tenancy = tenancy;
  }

  override createDriver(): Driver {
    return new TenantDriver(super.createDriver(), this.#tenancy);
  }
}

/**
 * The only place that touches the pg driver. Everything else receives the
 * typed Kysely instance.
 */
export function createDatabase(
  connectionString: string,
  options: { max?: number; tenancy?: Tenancy } = {},
): Kysely<Database> {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  const tenancy = options.tenancy ?? 'single';
  return new Kysely<Database>({
    dialect: tenancy === 'off' ? new PostgresDialect({ pool }) : new TenantDialect(pool, tenancy),
  });
}

/**
 * Fails fast unless every client connection keeps its own session state.
 * The tenant is a session setting (TenantDriver), so a pooler in transaction
 * or statement mode would run one organisation's queries with another's
 * tenant. Two clients set a marker one after the other (a pooler hands the
 * server connection that A just released to B), then each reads its marker
 * and backend pid back a few times.
 */
export async function assertSessionPooling(connectionString: string): Promise<void> {
  const clients = [new pg.Client({ connectionString }), new pg.Client({ connectionString })];
  await Promise.all(clients.map((c) => c.connect()));
  try {
    const markers = clients.map(() => randomUUID());
    const pids: number[] = [];
    for (const [i, c] of clients.entries()) {
      const { rows } = await c.query<{ pid: number }>(
        "select set_config('app.pooler_probe', $1, false), pg_backend_pid() as pid",
        [markers[i]],
      );
      pids.push(rows[0]?.pid ?? -1);
    }
    for (let round = 0; round < 3; round++)
      for (const [i, c] of clients.entries()) {
        const { rows } = await c.query<{ v: string | null; pid: number }>(
          "select current_setting('app.pooler_probe', true) as v, pg_backend_pid() as pid",
        );
        if (rows[0]?.v !== markers[i] || rows[0]?.pid !== pids[i])
          throw new Error(
            'The database connection does not keep session state between statements ' +
              '(a pooler in transaction or statement mode?). Several organisations need session ' +
              'pooling or a direct connection; see SECURITY.md.',
          );
      }
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
}
