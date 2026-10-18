// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { pgUrl, type PgInfo } from './postgres.js';

/**
 * Clones the migrated template into a new database per test file. Uses the
 * pg driver directly with constant SQL; test support code only.
 */
export async function createTestDatabase(
  pg: PgInfo,
): Promise<{ url: string; migratorUrl: string; drop: () => Promise<void> }> {
  const name = `t_${randomBytes(6).toString('hex')}`;
  const admin = new Client({ connectionString: pgUrl(pg, 'postgres', 'postgres') });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${pg.template}`);
  } finally {
    await admin.end();
  }
  return {
    url: pgUrl(pg, 'coursecraft_app', name),
    migratorUrl: pgUrl(pg, 'coursecraft_migrator', name),
    drop: async () => {
      const c = new Client({ connectionString: pgUrl(pg, 'postgres', 'postgres') });
      await c.connect();
      try {
        await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await c.end();
      }
    },
  };
}
