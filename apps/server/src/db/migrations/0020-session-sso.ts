// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';

/** Which provider a session came from, and the sealed data to sign out there too. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('sessions')
    .addColumn('sso_provider_id', 'uuid', (c) => c.references('sso_providers.id').onDelete('set null'))
    .addColumn('sso_logout', 'jsonb')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('sessions').dropColumn('sso_logout').dropColumn('sso_provider_id').execute();
}
