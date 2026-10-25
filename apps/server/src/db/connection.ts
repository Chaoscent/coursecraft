// SPDX-License-Identifier: Apache-2.0
import {
  Kysely,
  PostgresDialect,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
  type TransactionSettings,
} from 'kysely';
import pg from 'pg';
import { currentScope, DEFAULT_TENANT_ID } from '../tenancy/context.js';
import {
  BEGIN_TX as BEGIN,
  COMMIT_TX as COMMIT,
  ROLLBACK_TX as ROLLBACK,
  setLocalTenantQuery,
} from './migrations/sql-helpers.js';
import type { Database } from './schema.js';

/**
 * - `off`: no tenant (the migrator, which owns the tables and is not subject to row-level security).
 * - `single`: the default tenant unless a scope says otherwise.
 * - `multi`: the scope decides; without one, queries on tenant tables fail.
 */
export type Tenancy = 'off' | 'single' | 'multi';

/** The compiled-query parameter types of a Kysely connection, without naming the raw SQL type. */
type AnyCompiledQuery = Parameters<DatabaseConnection['executeQuery']>[0];

/**
 * Wraps a pooled connection so the tenant is set transaction-locally
 * (SECURITY_AUDIT.md F-05). Every autocommit query is run as `begin;
 * set_config('app.tenant_id', …, true); <query>; commit`, so the setting and
 * the query always share one transaction — and therefore one backend
 * connection, even through a transaction-mode pooler. Inside an explicit
 * transaction the driver sets the tenant once, right after `begin`.
 */
class TenantConnection implements DatabaseConnection {
  readonly inner: DatabaseConnection;
  readonly tenantId: string;
  inTransaction = false;

  constructor(inner: DatabaseConnection, tenantId: string) {
    this.inner = inner;
    this.tenantId = tenantId;
  }

  async executeQuery<R>(compiledQuery: AnyCompiledQuery): Promise<QueryResult<R>> {
    if (this.inTransaction) return this.inner.executeQuery<R>(compiledQuery);
    await this.inner.executeQuery(BEGIN);
    try {
      await this.inner.executeQuery(setLocalTenantQuery(this.tenantId));
      const result = await this.inner.executeQuery<R>(compiledQuery);
      await this.inner.executeQuery(COMMIT);
      return result;
    } catch (error) {
      await this.inner.executeQuery(ROLLBACK).catch(() => undefined);
      throw error;
    }
  }

  async *streamQuery<R>(
    compiledQuery: AnyCompiledQuery,
    chunkSize: number,
  ): AsyncIterableIterator<QueryResult<R>> {
    if (this.inTransaction) {
      yield* this.inner.streamQuery<R>(compiledQuery, chunkSize);
      return;
    }
    await this.inner.executeQuery(BEGIN);
    let ok = false;
    try {
      await this.inner.executeQuery(setLocalTenantQuery(this.tenantId));
      yield* this.inner.streamQuery<R>(compiledQuery, chunkSize);
      ok = true;
    } finally {
      await this.inner.executeQuery(ok ? COMMIT : ROLLBACK).catch(() => undefined);
    }
  }
}

/**
 * Sets the tenant per transaction, not per session, so it is correct behind
 * any connection pooler (SECURITY_AUDIT.md F-05). Wraps the inner Postgres
 * driver; begin/commit/rollback act on the wrapped connection's inner handle.
 */
class TenantDriver implements Driver {
  readonly #inner: Driver;
  readonly #tenancy: Exclude<Tenancy, 'off'>;

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
    return new TenantConnection(connection, wanted);
  }

  async beginTransaction(connection: DatabaseConnection, settings: TransactionSettings): Promise<void> {
    const wrapper = connection as TenantConnection;
    await this.#inner.beginTransaction(wrapper.inner, settings);
    // The tenant is bound to this transaction, so every statement in it is scoped.
    await wrapper.inner.executeQuery(setLocalTenantQuery(wrapper.tenantId));
    wrapper.inTransaction = true;
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    const wrapper = connection as TenantConnection;
    wrapper.inTransaction = false;
    await this.#inner.commitTransaction(wrapper.inner);
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    const wrapper = connection as TenantConnection;
    wrapper.inTransaction = false;
    await this.#inner.rollbackTransaction(wrapper.inner);
  }

  releaseConnection(connection: DatabaseConnection): Promise<void> {
    return this.#inner.releaseConnection((connection as TenantConnection).inner);
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
