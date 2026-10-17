// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { emptyJsonObject, ident, now, oneOf, randomUuid } from './sql-helpers.js';

const COURSE_STATUS = ['draft', 'archived'] as const;
const MEMBER_ROLES = ['editor'] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('courses')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('title', 'text', (c) => c.notNull())
    .addColumn('owner_id', 'uuid', (c) => c.notNull().references('users.id'))
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('draft'))
    .addColumn('format_version', 'integer', (c) => c.notNull())
    /** Course-level parts of the document: meta, languages, settings, structure. */
    .addColumn('meta', 'jsonb', (c) => c.notNull().defaultTo(emptyJsonObject()))
    .addColumn('languages', 'jsonb', (c) => c.notNull())
    .addColumn('settings', 'jsonb', (c) => c.notNull().defaultTo(emptyJsonObject()))
    .addColumn('structure', 'jsonb', (c) => c.notNull())
    .addColumn('rev', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addCheckConstraint('courses_status_check', oneOf(ident('status'), COURSE_STATUS))
    .execute();
  await db.schema.createIndex('courses_owner_idx').on('courses').column('owner_id').execute();

  await db.schema
    .createTable('course_members')
    .addColumn('course_id', 'uuid', (c) => c.notNull().references('courses.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('role', 'text', (c) => c.notNull().defaultTo('editor'))
    .addPrimaryKeyConstraint('course_members_pkey', ['course_id', 'user_id'])
    .addCheckConstraint('course_members_role_check', oneOf(ident('role'), MEMBER_ROLES))
    .execute();

  await db.schema
    .createTable('course_nodes')
    .addColumn('course_id', 'uuid', (c) => c.notNull().references('courses.id').onDelete('cascade'))
    .addColumn('node_id', 'text', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('doc', 'jsonb', (c) => c.notNull())
    .addColumn('rev', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('updated_by', 'uuid')
    .addPrimaryKeyConstraint('course_nodes_pkey', ['course_id', 'node_id'])
    .execute();

  await db.schema
    .createTable('assets')
    .addColumn('sha256', 'text', (c) => c.primaryKey())
    .addColumn('mime', 'text', (c) => c.notNull())
    .addColumn('size', 'bigint', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('created_by', 'uuid')
    .execute();

  await db.schema
    .createTable('course_assets')
    .addColumn('course_id', 'uuid', (c) => c.notNull().references('courses.id').onDelete('cascade'))
    .addColumn('sha256', 'text', (c) => c.notNull().references('assets.sha256'))
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addPrimaryKeyConstraint('course_assets_pkey', ['course_id', 'sha256'])
    .execute();

  await db.schema
    .createTable('course_locks')
    .addColumn('course_id', 'uuid', (c) => c.primaryKey().references('courses.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('session_id', 'uuid', (c) => c.notNull())
    .addColumn('acquired_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('heartbeat_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .execute();

  await db.schema
    .createTable('course_versions')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('course_id', 'uuid', (c) => c.notNull().references('courses.id').onDelete('cascade'))
    .addColumn('number', 'integer', (c) => c.notNull())
    .addColumn('note', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('snapshot', 'jsonb', (c) => c.notNull())
    .addColumn('created_by', 'uuid')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addUniqueConstraint('course_versions_number_key', ['course_id', 'number'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    'course_versions',
    'course_locks',
    'course_assets',
    'assets',
    'course_nodes',
    'course_members',
    'courses',
  ]) {
    await db.schema.dropTable(table).execute();
  }
}
