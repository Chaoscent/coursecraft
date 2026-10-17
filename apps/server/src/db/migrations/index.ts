// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { Migrator, type Migration } from 'kysely/migration';
import { ident, revokeWrites } from './sql-helpers.js';
import * as m0001 from './0001-initial.js';
import * as m0002 from './0002-identity.js';
import * as m0003 from './0003-courses.js';
import * as m0004 from './0004-conversions.js';
import * as m0005 from './0005-lms.js';
import * as m0006 from './0006-ai.js';

/** Ordered list of all migrations. Released migrations never change. */
export const MIGRATIONS: Readonly<Record<string, Migration>> = {
  '0001-initial': m0001,
  '0002-identity': m0002,
  '0003-courses': m0003,
  '0004-conversions': m0004,
  '0005-lms': m0005,
  '0006-ai': m0006,
};

/**
 * Privilege restrictions that must hold after every migration run, also
 * after a restore (replayed tables get the role's default privileges again).
 */
export async function enforcePrivileges<DB>(db: Kysely<DB>): Promise<void> {
  await revokeWrites(db, ident('audit_log'), ident('coursecraft_app'));
}

export const LATEST_MIGRATION = Object.keys(MIGRATIONS).sort().at(-1);

export function createMigrator<DB>(db: Kysely<DB>): Migrator {
  return new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve({ ...MIGRATIONS }) },
  });
}
