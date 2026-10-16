// SPDX-License-Identifier: Apache-2.0
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

/**
 * The only place that touches the pg driver. Everything else receives the
 * typed Kysely instance.
 */
export function createDatabase(connectionString: string, options: { max?: number } = {}): Kysely<Database> {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
