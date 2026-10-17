// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { emptyJsonObject, exactlyOne, ident, now, oneOf, randomUuid } from './sql-helpers.js';

const PACKAGE_KINDS = ['coursecraft', 'scorm12', 'scorm2004', 'xapi', 'cmi5'] as const;
const ITEM_STATUS = ['active', 'archived'] as const;
const COMPLETION = ['unknown', 'incomplete', 'completed'] as const;
const SUCCESS = ['unknown', 'passed', 'failed'] as const;
const DOC_KINDS = ['state', 'activity_profile', 'agent_profile'] as const;

/** LMS core: library, assignments, registrations, launches, SCORM data, LRS. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('packages')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('title', 'text', (c) => c.notNull())
    .addColumn('launch_path', 'text', (c) => c.notNull())
    .addColumn('manifest', 'jsonb', (c) => c.notNull().defaultTo(emptyJsonObject()))
    .addColumn('size', 'bigint', (c) => c.notNull())
    .addColumn('source_course_id', 'uuid', (c) => c.references('courses.id').onDelete('set null'))
    .addColumn('source_version', 'integer')
    .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addCheckConstraint('packages_kind_check', oneOf(ident('kind'), PACKAGE_KINDS))
    .execute();

  await db.schema
    .createTable('library_items')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('package_id', 'uuid', (c) => c.notNull().references('packages.id'))
    .addColumn('title', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('active'))
    .addColumn('source_course_id', 'uuid', (c) => c.references('courses.id').onDelete('set null'))
    .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addCheckConstraint('library_items_status_check', oneOf(ident('status'), ITEM_STATUS))
    .execute();

  await db.schema
    .createTable('assignments')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('library_item_id', 'uuid', (c) =>
      c.notNull().references('library_items.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (c) => c.references('users.id').onDelete('cascade'))
    .addColumn('group_id', 'uuid', (c) => c.references('groups.id').onDelete('cascade'))
    .addColumn('due_at', 'timestamptz')
    .addColumn('created_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addCheckConstraint('assignments_target_check', exactlyOne(ident('user_id'), ident('group_id')))
    .execute();
  await db.schema.createIndex('assignments_item_idx').on('assignments').column('library_item_id').execute();

  await db.schema
    .createTable('registrations')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('library_item_id', 'uuid', (c) =>
      c.notNull().references('library_items.id').onDelete('cascade'),
    )
    .addColumn('package_id', 'uuid', (c) => c.notNull().references('packages.id'))
    .addColumn('attempt', 'integer', (c) => c.notNull())
    .addColumn('completion', 'text', (c) => c.notNull().defaultTo('unknown'))
    .addColumn('success', 'text', (c) => c.notNull().defaultTo('unknown'))
    .addColumn('score_scaled', 'double precision')
    .addColumn('time_spent_ms', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('started_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('last_activity_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('completed_at', 'timestamptz')
    .addUniqueConstraint('registrations_attempt_key', ['user_id', 'library_item_id', 'attempt'])
    .addCheckConstraint('registrations_completion_check', oneOf(ident('completion'), COMPLETION))
    .addCheckConstraint('registrations_success_check', oneOf(ident('success'), SUCCESS))
    .execute();
  await db.schema
    .createIndex('registrations_item_idx')
    .on('registrations')
    .column('library_item_id')
    .execute();

  await db.schema
    .createTable('launch_tokens')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('token_hash', 'text', (c) => c.notNull().unique())
    .addColumn('registration_id', 'uuid', (c) =>
      c.notNull().references('registrations.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    // Ending the session (logout, deactivation) ends its launches.
    .addColumn('session_id', 'uuid', (c) => c.notNull().references('sessions.id').onDelete('cascade'))
    .addColumn('package_id', 'uuid', (c) => c.notNull().references('packages.id'))
    .addColumn('mode', 'text', (c) => c.notNull().defaultTo('Normal'))
    .addColumn('fetch_used', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('absolute_expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('revoked_at', 'timestamptz')
    .execute();

  await db.schema
    .createTable('scorm_runtime')
    .addColumn('registration_id', 'uuid', (c) =>
      c.primaryKey().references('registrations.id').onDelete('cascade'),
    )
    .addColumn('cmi', 'jsonb', (c) => c.notNull().defaultTo(emptyJsonObject()))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .execute();

  await db.schema
    .createTable('lrs_statements')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('stored', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addColumn('statement', 'jsonb', (c) => c.notNull())
    .addColumn('actor_key', 'text', (c) => c.notNull())
    .addColumn('verb_id', 'text', (c) => c.notNull())
    .addColumn('activity_id', 'text')
    .addColumn('registration', 'uuid')
    .addColumn('voided', 'boolean', (c) => c.notNull().defaultTo(false))
    .execute();
  await db.schema
    .createIndex('lrs_statements_registration_idx')
    .on('lrs_statements')
    .columns(['registration', 'stored'])
    .execute();
  await db.schema
    .createIndex('lrs_statements_activity_idx')
    .on('lrs_statements')
    .columns(['activity_id', 'stored'])
    .execute();

  await db.schema
    .createTable('lrs_documents')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('activity_id', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('agent_key', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('registration', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('doc_id', 'text', (c) => c.notNull())
    .addColumn('content', 'bytea', (c) => c.notNull())
    .addColumn('content_type', 'text', (c) => c.notNull())
    .addColumn('etag', 'text', (c) => c.notNull())
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addUniqueConstraint('lrs_documents_key', ['kind', 'activity_id', 'agent_key', 'registration', 'doc_id'])
    .addCheckConstraint('lrs_documents_kind_check', oneOf(ident('kind'), DOC_KINDS))
    .execute();

  await db.schema
    .createTable('quiz_responses')
    .addColumn('registration_id', 'uuid', (c) =>
      c.notNull().references('registrations.id').onDelete('cascade'),
    )
    .addColumn('question_id', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('interaction_type', 'text', (c) => c.notNull().defaultTo('other'))
    .addColumn('response', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('success', 'boolean')
    .addColumn('score_raw', 'double precision')
    .addColumn('score_max', 'double precision')
    .addColumn('needs_manual_grading', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('manual_score', 'double precision')
    .addColumn('graded_by', 'uuid', (c) => c.references('users.id').onDelete('set null'))
    .addColumn('graded_at', 'timestamptz')
    .addColumn('answered_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .addPrimaryKeyConstraint('quiz_responses_pkey', ['registration_id', 'question_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    'quiz_responses',
    'lrs_documents',
    'lrs_statements',
    'scorm_runtime',
    'launch_tokens',
    'registrations',
    'assignments',
    'library_items',
    'packages',
  ])
    await db.schema.dropTable(table).execute();
}
