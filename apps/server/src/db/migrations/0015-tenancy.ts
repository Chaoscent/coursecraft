// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import {
  currentTenant,
  DEFAULT_TENANT_ID,
  dropTenantIsolation,
  ident,
  isolateTenants,
  now,
  oneOf,
  randomUuid,
  type TrustedIdentifier,
} from './sql-helpers.js';

/** Every table holding data of one organisation (all but platform tables). */
const TABLES = [
  'settings',
  'users',
  'user_roles',
  'groups',
  'group_members',
  'sessions',
  'login_challenges',
  'setup_state',
  'audit_log',
  'ai_providers',
  'ai_user_keys',
  'ai_previews',
  'ai_usage',
  'packages',
  'library_items',
  'assignments',
  'registrations',
  'launch_tokens',
  'scorm_runtime',
  'lrs_statements',
  'lrs_documents',
  'quiz_responses',
  'courses',
  'course_members',
  'course_nodes',
  'assets',
  'course_assets',
  'course_locks',
  'course_versions',
  'conversions',
  'password_resets',
  'assignment_notices',
  'directory_attempts',
  'learning_paths',
  'path_steps',
  'path_assignments',
  'certificates',
  'sso_providers',
  'sso_states',
  'user_identities',
] as const;

const tableIdent = (name: (typeof TABLES)[number]): TrustedIdentifier => ident(name);

/**
 * Tenants: one installation can serve several organisations, each under its
 * own addresses. Every organisation table gets `tenant_id`, filled from the
 * connection's tenant, and PostgreSQL's row-level security keeps the rows of
 * different tenants apart for the app role. Existing data belongs to the
 * default tenant, which is all a single-tenant installation ever uses.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('tenants')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('name', 'text', (c) => c.notNull())
    // Full origins (scheme, host, port); null for the default tenant of a single installation.
    .addColumn('public_origin', 'text', (c) => c.unique())
    .addColumn('content_origin', 'text', (c) => c.unique())
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('active'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addCheckConstraint('tenants_status_check', oneOf(ident('status'), ['active', 'disabled']))
    .execute();
  await db
    .withTables<{ tenants: { id: string; name: string } }>()
    .insertInto('tenants')
    .values({ id: DEFAULT_TENANT_ID, name: 'Default' })
    .execute();

  // No index on tenant_id alone: rows are found through their own keys (ids are unique
  // across tenants), and a column with few distinct values only misleads the planner.
  for (const name of TABLES) {
    await db.schema
      .alterTable(name)
      .addColumn('tenant_id', 'uuid', (c) =>
        c.notNull().defaultTo(DEFAULT_TENANT_ID).references('tenants.id').onDelete('cascade'),
      )
      .execute();
    await db.schema
      .alterTable(name)
      .alterColumn('tenant_id', (c) => c.setDefault(currentTenant()))
      .execute();
  }

  // Natural keys become unique per tenant.
  await db.schema.alterTable('settings').dropConstraint('settings_pkey').execute();
  await db.schema
    .alterTable('settings')
    .addPrimaryKeyConstraint('settings_pkey', ['tenant_id', 'key'])
    .execute();
  await db.schema.alterTable('setup_state').dropConstraint('setup_state_pkey').execute();
  await db.schema
    .alterTable('setup_state')
    .addPrimaryKeyConstraint('setup_state_pkey', ['tenant_id', 'id'])
    .execute();
  await db.schema.alterTable('users').dropConstraint('users_email_key').execute();
  await db.schema
    .alterTable('users')
    .addUniqueConstraint('users_email_key', ['tenant_id', 'email'])
    .execute();
  await db.schema.alterTable('groups').dropConstraint('groups_name_key').execute();
  await db.schema
    .alterTable('groups')
    .addUniqueConstraint('groups_name_key', ['tenant_id', 'name'])
    .execute();
  await db.schema.alterTable('course_assets').dropConstraint('course_assets_sha256_fkey').execute();
  await db.schema.alterTable('assets').dropConstraint('assets_pkey').execute();
  await db.schema
    .alterTable('assets')
    .addPrimaryKeyConstraint('assets_pkey', ['tenant_id', 'sha256'])
    .execute();
  await db.schema
    .alterTable('course_assets')
    .addForeignKeyConstraint('course_assets_asset_fkey', ['tenant_id', 'sha256'], 'assets', [
      'tenant_id',
      'sha256',
    ])
    .execute();
  await db.schema.alterTable('lrs_documents').dropConstraint('lrs_documents_key').execute();
  await db.schema
    .alterTable('lrs_documents')
    .addUniqueConstraint('lrs_documents_key', [
      'tenant_id',
      'kind',
      'activity_id',
      'agent_key',
      'registration',
      'doc_id',
    ])
    .execute();

  for (const name of TABLES) await isolateTenants(db, tableIdent(name));
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const name of TABLES) await dropTenantIsolation(db, tableIdent(name));
  await db.schema.alterTable('lrs_documents').dropConstraint('lrs_documents_key').execute();
  await db.schema
    .alterTable('lrs_documents')
    .addUniqueConstraint('lrs_documents_key', ['kind', 'activity_id', 'agent_key', 'registration', 'doc_id'])
    .execute();
  await db.schema.alterTable('course_assets').dropConstraint('course_assets_asset_fkey').execute();
  await db.schema.alterTable('assets').dropConstraint('assets_pkey').execute();
  await db.schema.alterTable('assets').addPrimaryKeyConstraint('assets_pkey', ['sha256']).execute();
  await db.schema
    .alterTable('course_assets')
    .addForeignKeyConstraint('course_assets_sha256_fkey', ['sha256'], 'assets', ['sha256'])
    .execute();
  await db.schema.alterTable('groups').dropConstraint('groups_name_key').execute();
  await db.schema.alterTable('groups').addUniqueConstraint('groups_name_key', ['name']).execute();
  await db.schema.alterTable('users').dropConstraint('users_email_key').execute();
  await db.schema.alterTable('users').addUniqueConstraint('users_email_key', ['email']).execute();
  await db.schema.alterTable('setup_state').dropConstraint('setup_state_pkey').execute();
  await db.schema.alterTable('setup_state').addPrimaryKeyConstraint('setup_state_pkey', ['id']).execute();
  await db.schema.alterTable('settings').dropConstraint('settings_pkey').execute();
  await db.schema.alterTable('settings').addPrimaryKeyConstraint('settings_pkey', ['key']).execute();
  for (const name of TABLES) await db.schema.alterTable(name).dropColumn('tenant_id').execute();
  await db.schema.dropTable('tenants').execute();
}
