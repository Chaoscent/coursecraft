// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { ident, now, oneOf, randomUuid } from './sql-helpers.js';

const KINDS = ['oidc', 'saml'] as const;
const ROLES = ['learner', 'author', 'trainer'] as const;

/** Single sign-on: providers set up by administrators, pending logins, linked identities. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('sso_providers')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('config', 'jsonb', (c) => c.notNull())
    .addColumn('secret', 'jsonb')
    .addColumn('secret_last4', 'text')
    .addColumn('allowed_domains', 'jsonb', (c) => c.notNull().defaultTo('[]'))
    .addColumn('auto_create', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('default_role', 'text', (c) => c.notNull().defaultTo('learner'))
    .addColumn('email_trusted', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addCheckConstraint('sso_providers_kind_check', oneOf(ident('kind'), KINDS))
    .addCheckConstraint('sso_providers_role_check', oneOf(ident('default_role'), ROLES))
    .execute();

  // One row per started login; single use, bound to the browser by a cookie.
  await db.schema
    .createTable('sso_states')
    .addColumn('state_hash', 'text', (c) => c.primaryKey())
    .addColumn('provider_id', 'uuid', (c) => c.notNull().references('sso_providers.id').onDelete('cascade'))
    .addColumn('binder_hash', 'text', (c) => c.notNull())
    .addColumn('nonce', 'text')
    .addColumn('code_verifier', 'jsonb')
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('user_identities')
    .addColumn('provider_id', 'uuid', (c) => c.notNull().references('sso_providers.id').onDelete('cascade'))
    .addColumn('subject', 'text', (c) => c.notNull())
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addPrimaryKeyConstraint('user_identities_pkey', ['provider_id', 'subject'])
    .execute();
  await db.schema.createIndex('user_identities_user_idx').on('user_identities').column('user_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ['user_identities', 'sso_states', 'sso_providers'])
    await db.schema.dropTable(table).execute();
}
