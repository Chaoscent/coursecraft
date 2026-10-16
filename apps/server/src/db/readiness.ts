// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import type { Readiness } from '../http/app.js';
import { LATEST_MIGRATION } from './migrations/index.js';
import type { Database } from './schema.js';

export async function checkReadiness(db: Kysely<Database>): Promise<Readiness> {
  try {
    const last = await db
      .selectFrom('kysely_migration')
      .select('name')
      .orderBy('name', 'desc')
      .limit(1)
      .executeTakeFirst();
    return { database: true, migrations: last?.name === LATEST_MIGRATION };
  } catch {
    return { database: false, migrations: false };
  }
}
