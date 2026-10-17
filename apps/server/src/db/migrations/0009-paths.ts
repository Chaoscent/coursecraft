// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { exactlyOne, ident, now, oneOf, randomUuid } from './sql-helpers.js';

const STATUS = ['active', 'archived'] as const;

/** Learning paths: ordered library items, assigned like single items. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('learning_paths')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('title', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('sequential', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('active'))
    .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addCheckConstraint('learning_paths_status_check', oneOf(ident('status'), STATUS))
    .execute();

  await db.schema
    .createTable('path_steps')
    .addColumn('path_id', 'uuid', (c) => c.notNull().references('learning_paths.id').onDelete('cascade'))
    .addColumn('position', 'integer', (c) => c.notNull())
    .addColumn('library_item_id', 'uuid', (c) => c.notNull().references('library_items.id'))
    .addPrimaryKeyConstraint('path_steps_pkey', ['path_id', 'position'])
    .addUniqueConstraint('path_steps_item_unique', ['path_id', 'library_item_id'])
    .execute();

  await db.schema
    .createTable('path_assignments')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('path_id', 'uuid', (c) => c.notNull().references('learning_paths.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (c) => c.references('users.id').onDelete('cascade'))
    .addColumn('group_id', 'uuid', (c) => c.references('groups.id').onDelete('cascade'))
    .addColumn('due_at', 'timestamptz')
    .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addCheckConstraint('path_assignments_target_check', exactlyOne(ident('user_id'), ident('group_id')))
    .execute();
  await db.schema.createIndex('path_assignments_path_idx').on('path_assignments').column('path_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ['path_assignments', 'path_steps', 'learning_paths'])
    await db.schema.dropTable(table).execute();
}
