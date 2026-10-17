// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { ident, now, oneOf, randomUuid } from './sql-helpers.js';

const KINDS = ['anthropic', 'openai'] as const;
const TASKS = ['rewrite', 'questions'] as const;

/** Optional AI adapter: providers (keys sealed), per-user keys, confirmed previews, daily usage. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('ai_providers')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('base_url', 'text', (c) => c.notNull())
    .addColumn('model', 'text', (c) => c.notNull())
    .addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('allow_user_keys', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('daily_quota', 'integer')
    .addColumn('api_key', 'jsonb')
    .addColumn('api_key_last4', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addCheckConstraint('ai_providers_kind_check', oneOf(ident('kind'), KINDS))
    .execute();

  await db.schema
    .createTable('ai_user_keys')
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('provider_id', 'uuid', (c) => c.notNull().references('ai_providers.id').onDelete('cascade'))
    .addColumn('api_key', 'jsonb', (c) => c.notNull())
    .addColumn('last4', 'text', (c) => c.notNull())
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addPrimaryKeyConstraint('ai_user_keys_pkey', ['user_id', 'provider_id'])
    .execute();

  // The exact request a user saw; sending it later uses this row, not new input.
  await db.schema
    .createTable('ai_previews')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('provider_id', 'uuid', (c) => c.notNull().references('ai_providers.id').onDelete('cascade'))
    .addColumn('course_id', 'uuid', (c) => c.notNull().references('courses.id').onDelete('cascade'))
    .addColumn('task', 'text', (c) => c.notNull())
    .addColumn('body', 'text', (c) => c.notNull())
    .addColumn('input_chars', 'integer', (c) => c.notNull())
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addCheckConstraint('ai_previews_task_check', oneOf(ident('task'), TASKS))
    .execute();
  await db.schema.createIndex('ai_previews_expires_idx').on('ai_previews').column('expires_at').execute();

  await db.schema
    .createTable('ai_usage')
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('provider_id', 'uuid', (c) => c.notNull().references('ai_providers.id').onDelete('cascade'))
    .addColumn('day', 'date', (c) => c.notNull())
    .addColumn('requests', 'integer', (c) => c.notNull().defaultTo(0))
    .addPrimaryKeyConstraint('ai_usage_pkey', ['user_id', 'provider_id', 'day'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ['ai_usage', 'ai_previews', 'ai_user_keys', 'ai_providers'])
    await db.schema.dropTable(table).execute();
}
