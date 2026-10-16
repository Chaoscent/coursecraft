// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { Migrator, type Migration } from 'kysely/migration';
import * as m0001 from './0001-initial.js';
import * as m0002 from './0002-identity.js';

/** Ordered list of all migrations. Released migrations never change. */
export const MIGRATIONS: Readonly<Record<string, Migration>> = {
  '0001-initial': m0001,
  '0002-identity': m0002,
};

export const LATEST_MIGRATION = Object.keys(MIGRATIONS).sort().at(-1);

export function createMigrator<DB>(db: Kysely<DB>): Migrator {
  return new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve({ ...MIGRATIONS }) },
  });
}
