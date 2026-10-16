// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { emptyJsonObject, equals, ident, now, oneOf, randomUuid, revokeWrites } from './sql-helpers.js';

// Copies of the values at the time of this migration; never import live enums here.
const ROLES = ['admin', 'author', 'trainer', 'learner'] as const;
const USER_STATUS = ['active', 'disabled'] as const;
const LOCALES = ['de', 'en'] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('email', 'text', (c) => c.notNull().unique())
    .addColumn('display_name', 'text', (c) => c.notNull())
    .addColumn('password_hash', 'text')
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('active'))
    .addColumn('locale', 'text', (c) => c.notNull().defaultTo('de'))
    .addColumn('totp_secret', 'jsonb')
    .addColumn('totp_last_step', 'bigint')
    .addColumn('must_change_password', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('failed_logins', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('locked_until', 'timestamptz')
    .addColumn('last_login_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('deleted_at', 'timestamptz')
    .addCheckConstraint('users_status_check', oneOf(ident('status'), USER_STATUS))
    .addCheckConstraint('users_locale_check', oneOf(ident('locale'), LOCALES))
    .execute();

  await db.schema
    .createTable('user_roles')
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('role', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('user_roles_pkey', ['user_id', 'role'])
    .addCheckConstraint('user_roles_role_check', oneOf(ident('role'), ROLES))
    .execute();

  await db.schema
    .createTable('groups')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('name', 'text', (c) => c.notNull().unique())
    .addColumn('parent_id', 'uuid', (c) => c.references('groups.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .execute();

  await db.schema
    .createTable('group_members')
    .addColumn('group_id', 'uuid', (c) => c.notNull().references('groups.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addPrimaryKeyConstraint('group_members_pkey', ['group_id', 'user_id'])
    .execute();
  await db.schema.createIndex('group_members_user_idx').on('group_members').column('user_id').execute();

  await db.schema
    .createTable('sessions')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('token_hash', 'text', (c) => c.notNull().unique())
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('last_seen_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('idle_expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('absolute_expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('rotate_pending', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('ip_hmac', 'text')
    .addColumn('user_agent', 'text')
    .execute();
  await db.schema.createIndex('sessions_user_idx').on('sessions').column('user_id').execute();

  await db.schema
    .createTable('login_challenges')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('token_hash', 'text', (c) => c.notNull().unique())
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createTable('setup_state')
    .addColumn('id', 'integer', (c) => c.primaryKey())
    .addColumn('completed_at', 'timestamptz')
    .addColumn('token_hash', 'text')
    .addColumn('token_expires_at', 'timestamptz')
    .addCheckConstraint('setup_state_singleton', equals(ident('id'), 1))
    .execute();

  await db.schema
    .createTable('audit_log')
    .addColumn('id', 'bigserial', (c) => c.primaryKey())
    .addColumn('at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    // No foreign key: entries must outlive any change to the referenced rows.
    .addColumn('actor_user_id', 'uuid')
    .addColumn('action', 'text', (c) => c.notNull())
    .addColumn('target_type', 'text')
    .addColumn('target_id', 'text')
    .addColumn('meta', 'jsonb', (c) => c.notNull().defaultTo(emptyJsonObject()))
    .addColumn('ip_hmac', 'text')
    .execute();
  await db.schema.createIndex('audit_log_at_idx').on('audit_log').column('at').execute();
  await db.schema.createIndex('audit_log_actor_idx').on('audit_log').column('actor_user_id').execute();
  await revokeWrites(db, ident('audit_log'), ident('lernwerk_app'));
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    'audit_log',
    'setup_state',
    'login_challenges',
    'sessions',
    'group_members',
    'groups',
    'user_roles',
    'users',
  ]) {
    await db.schema.dropTable(table).execute();
  }
}
