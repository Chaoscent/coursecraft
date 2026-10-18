// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { Migrator, type Migration } from 'kysely/migration';
import { ident, readOnlyFor, revokeWrites } from './sql-helpers.js';
import * as m0001 from './0001-initial.js';
import * as m0002 from './0002-identity.js';
import * as m0003 from './0003-courses.js';
import * as m0004 from './0004-conversions.js';
import * as m0005 from './0005-lms.js';
import * as m0006 from './0006-ai.js';
import * as m0007 from './0007-mail.js';
import * as m0008 from './0008-certificates.js';
import * as m0009 from './0009-paths.js';
import * as m0010 from './0010-sso.js';
import * as m0011 from './0011-ldap.js';
import * as m0012 from './0012-proxy-auth.js';
import * as m0013 from './0013-directory-attempts.js';
import * as m0014 from './0014-replicas.js';
import * as m0015 from './0015-tenancy.js';
import * as m0016 from './0016-group-managers.js';
import * as m0017 from './0017-tenant-quotas.js';
import * as m0018 from './0018-course-exports.js';

/** Ordered list of all migrations. Released migrations never change. */
export const MIGRATIONS: Readonly<Record<string, Migration>> = {
  '0001-initial': m0001,
  '0002-identity': m0002,
  '0003-courses': m0003,
  '0004-conversions': m0004,
  '0005-lms': m0005,
  '0006-ai': m0006,
  '0007-mail': m0007,
  '0008-certificates': m0008,
  '0009-paths': m0009,
  '0010-sso': m0010,
  '0011-ldap': m0011,
  '0012-proxy-auth': m0012,
  '0013-directory-attempts': m0013,
  '0014-replicas': m0014,
  '0015-tenancy': m0015,
  '0016-group-managers': m0016,
  '0017-tenant-quotas': m0017,
  '0018-course-exports': m0018,
};

/**
 * Privilege restrictions that must hold after every migration run, also
 * after a restore (replayed tables get the role's default privileges again).
 */
export async function enforcePrivileges<DB>(db: Kysely<DB>): Promise<void> {
  await revokeWrites(db, ident('audit_log'), ident('coursecraft_app'));
  // Tenants are created and changed by the operator (migrator role), never by the app.
  await readOnlyFor(db, ident('tenants'), ident('coursecraft_app'));
}

export const LATEST_MIGRATION = Object.keys(MIGRATIONS).sort().at(-1);

export function createMigrator<DB>(db: Kysely<DB>): Migrator {
  return new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve({ ...MIGRATIONS }) },
  });
}
