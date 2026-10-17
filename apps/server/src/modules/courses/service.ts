// SPDX-License-Identifier: Apache-2.0
import {
  collectAssetRefs,
  courseLanguagesSchema,
  courseMetaSchema,
  courseSettingsSchema,
  courseStructureSchema,
  loadCourse,
  nodeSchema,
  type CourseNode,
} from '@lernwerk/course-model';
import type { Kysely } from 'kysely';
import type { z } from 'zod';
import type { Database } from '../../db/schema.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { loadDocument } from './document.js';

type Structure = z.infer<typeof courseStructureSchema>;

function parseOr400<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw badRequest(`Invalid ${what}${issue ? `: ${issue.path.join('.')} ${issue.message}` : ''}`);
  }
  return result.data;
}

async function assertAssetsAttached(db: Kysely<Database>, courseId: string, value: unknown): Promise<void> {
  const refs = [...collectAssetRefs(value)];
  if (!refs.length) return;
  const found = await db
    .selectFrom('course_assets')
    .select('sha256')
    .where('course_id', '=', courseId)
    .where('sha256', 'in', refs)
    .execute();
  if (found.length !== refs.length) throw badRequest('Referenced file is not part of this course');
}

/** Bumps the course revision if it still matches; otherwise the client is out of date. */
async function bumpRev(tx: Kysely<Database>, courseId: string, rev: number): Promise<number> {
  const row = await tx
    .updateTable('courses')
    .set((eb) => ({ rev: eb('rev', '+', 1), updated_at: new Date() }))
    .where('id', '=', courseId)
    .where('rev', '=', rev)
    .returning('rev')
    .executeTakeFirst();
  if (!row) throw conflict('The course was changed in the meantime');
  return row.rev;
}

function assertStructureMatches(structure: Structure, nodeIds: Set<string>): void {
  const listed = structure.chapters.flatMap((c) => c.nodeIds);
  if (new Set(listed).size !== listed.length) throw badRequest('A node appears twice in the structure');
  if (listed.length !== nodeIds.size || listed.some((id) => !nodeIds.has(id))) {
    throw badRequest('The structure must list every node exactly once');
  }
}

export interface CourseChanges {
  rev: number;
  title?: string | undefined;
  meta?: unknown;
  languages?: unknown;
  settings?: unknown;
  structure?: unknown;
}

export async function updateCourse(db: Kysely<Database>, courseId: string, changes: CourseChanges) {
  return db.transaction().execute(async (tx) => {
    const set: Record<string, string> = {};
    if (changes.meta !== undefined) {
      const meta = parseOr400(courseMetaSchema, changes.meta, 'course information');
      set['meta'] = JSON.stringify({ ...meta, updatedAt: new Date().toISOString() });
    }
    if (changes.languages !== undefined)
      set['languages'] = JSON.stringify(parseOr400(courseLanguagesSchema, changes.languages, 'languages'));
    if (changes.settings !== undefined) {
      const settings = parseOr400(courseSettingsSchema, changes.settings, 'settings');
      await assertAssetsAttached(tx, courseId, settings);
      set['settings'] = JSON.stringify(settings);
    }
    if (changes.structure !== undefined) {
      const structure = parseOr400(courseStructureSchema, changes.structure, 'structure');
      const nodes = await tx
        .selectFrom('course_nodes')
        .select('node_id')
        .where('course_id', '=', courseId)
        .execute();
      assertStructureMatches(structure, new Set(nodes.map((n) => n.node_id)));
      set['structure'] = JSON.stringify(structure);
    }
    const rev = await bumpRev(tx, courseId, changes.rev);
    await tx
      .updateTable('courses')
      .set({
        ...(changes.title !== undefined ? { title: changes.title } : {}),
        ...(set['meta'] ? { meta: set['meta'] } : {}),
        ...(set['languages'] ? { languages: set['languages'] } : {}),
        ...(set['settings'] ? { settings: set['settings'] } : {}),
        ...(set['structure'] ? { structure: set['structure'] } : {}),
      })
      .where('id', '=', courseId)
      .execute();
    return rev;
  });
}

function parseNode(doc: unknown): CourseNode {
  return parseOr400(nodeSchema, doc, 'content');
}

export async function addNode(
  db: Kysely<Database>,
  courseId: string,
  input: { rev: number; chapterId: string; index: number; node: unknown },
  userId: string,
) {
  const node = parseNode(input.node);
  await assertAssetsAttached(db, courseId, node);
  return db.transaction().execute(async (tx) => {
    const course = await tx
      .selectFrom('courses')
      .select('structure')
      .where('id', '=', courseId)
      .executeTakeFirstOrThrow();
    const structure = course.structure;
    const chapter = structure.chapters.find((c) => c.id === input.chapterId);
    if (!chapter) throw badRequest('Unknown chapter');
    const exists = await tx
      .selectFrom('course_nodes')
      .select('node_id')
      .where('course_id', '=', courseId)
      .where('node_id', '=', node.id)
      .executeTakeFirst();
    if (exists) throw conflict('A node with this id exists');
    chapter.nodeIds.splice(Math.min(input.index, chapter.nodeIds.length), 0, node.id);
    const rev = await bumpRev(tx, courseId, input.rev);
    await tx
      .updateTable('courses')
      .set({ structure: JSON.stringify(structure) })
      .where('id', '=', courseId)
      .execute();
    await tx
      .insertInto('course_nodes')
      .values({
        course_id: courseId,
        node_id: node.id,
        kind: node.kind,
        doc: JSON.stringify(node),
        updated_by: userId,
      })
      .execute();
    return { rev, nodeRev: 1 };
  });
}

export async function updateNode(
  db: Kysely<Database>,
  courseId: string,
  nodeId: string,
  input: { rev: number; doc: unknown },
  userId: string,
) {
  const node = parseNode(input.doc);
  if (node.id !== nodeId) throw badRequest('Node id does not match');
  await assertAssetsAttached(db, courseId, node);
  const current = await db
    .selectFrom('course_nodes')
    .select(['kind'])
    .where('course_id', '=', courseId)
    .where('node_id', '=', nodeId)
    .executeTakeFirst();
  if (!current) throw notFound('Node not found');
  if (current.kind !== node.kind) throw badRequest('The kind of a node cannot change');
  const row = await db
    .updateTable('course_nodes')
    .set((eb) => ({
      doc: JSON.stringify(node),
      rev: eb('rev', '+', 1),
      updated_at: new Date(),
      updated_by: userId,
    }))
    .where('course_id', '=', courseId)
    .where('node_id', '=', nodeId)
    .where('rev', '=', input.rev)
    .returning('rev')
    .executeTakeFirst();
  if (!row) throw conflict('This content was changed in the meantime');
  await db.updateTable('courses').set({ updated_at: new Date() }).where('id', '=', courseId).execute();
  return row.rev;
}

export async function deleteNode(db: Kysely<Database>, courseId: string, nodeId: string, rev: number) {
  return db.transaction().execute(async (tx) => {
    const course = await tx
      .selectFrom('courses')
      .select('structure')
      .where('id', '=', courseId)
      .executeTakeFirstOrThrow();
    const structure = course.structure;
    const remaining = structure.chapters.reduce((n, c) => n + c.nodeIds.length, 0);
    if (remaining <= 1) throw conflict('A course needs at least one slide');
    for (const chapter of structure.chapters) chapter.nodeIds = chapter.nodeIds.filter((id) => id !== nodeId);
    const result = await tx
      .deleteFrom('course_nodes')
      .where('course_id', '=', courseId)
      .where('node_id', '=', nodeId)
      .executeTakeFirst();
    if (!Number(result.numDeletedRows)) throw notFound('Node not found');
    const next = await bumpRev(tx, courseId, rev);
    await tx
      .updateTable('courses')
      .set({ structure: JSON.stringify(structure) })
      .where('id', '=', courseId)
      .execute();
    return next;
  });
}

export async function createVersion(
  db: Kysely<Database>,
  courseId: string,
  note: string,
  userId: string,
): Promise<number> {
  const { course } = await loadDocument(db, courseId);
  const last = await db
    .selectFrom('course_versions')
    .select((eb) => eb.fn.max('number').as('n'))
    .where('course_id', '=', courseId)
    .executeTakeFirst();
  const number = Number(last?.n ?? 0) + 1;
  await db
    .insertInto('course_versions')
    .values({ course_id: courseId, number, note, snapshot: JSON.stringify(course), created_by: userId })
    .execute();
  return number;
}

/** Replaces the draft with a saved version; the current draft is saved first. */
export async function restoreVersion(
  db: Kysely<Database>,
  courseId: string,
  versionId: string,
  userId: string,
): Promise<number> {
  const version = await db
    .selectFrom('course_versions')
    .select(['snapshot', 'number'])
    .where('id', '=', versionId)
    .where('course_id', '=', courseId)
    .executeTakeFirst();
  if (!version) throw notFound('Version not found');
  const course = loadCourse(version.snapshot);
  await createVersion(db, courseId, `Before restoring version ${version.number}`, userId);
  return db.transaction().execute(async (tx) => {
    await tx.deleteFrom('course_nodes').where('course_id', '=', courseId).execute();
    for (const node of Object.values(course.nodes)) {
      await tx
        .insertInto('course_nodes')
        .values({
          course_id: courseId,
          node_id: node.id,
          kind: node.kind,
          doc: JSON.stringify(node),
          updated_by: userId,
        })
        .execute();
    }
    const row = await tx
      .updateTable('courses')
      .set((eb) => ({
        meta: JSON.stringify(course.meta),
        languages: JSON.stringify(course.languages),
        settings: JSON.stringify(course.settings),
        structure: JSON.stringify(course.structure),
        rev: eb('rev', '+', 1),
        updated_at: new Date(),
      }))
      .where('id', '=', courseId)
      .returning('rev')
      .executeTakeFirstOrThrow();
    return row.rev;
  });
}

export interface SaveBatch {
  rev: number;
  title?: string | undefined;
  meta?: unknown;
  languages?: unknown;
  settings?: unknown;
  structure?: unknown;
  upsertNodes: unknown[];
  deleteNodes: string[];
}

/**
 * Applies an editor save atomically: node upserts and deletions plus
 * course-level parts, then checks that structure and nodes still match.
 */
export async function saveBatch(db: Kysely<Database>, courseId: string, batch: SaveBatch, userId: string) {
  const nodes = batch.upsertNodes.map(parseNode);
  for (const node of nodes) await assertAssetsAttached(db, courseId, node);
  return db.transaction().execute(async (tx) => {
    const rev = await bumpRev(tx, courseId, batch.rev);
    const existing = await tx
      .selectFrom('course_nodes')
      .select(['node_id', 'kind'])
      .where('course_id', '=', courseId)
      .execute();
    const kinds = new Map(existing.map((n) => [n.node_id, n.kind]));
    if (batch.deleteNodes.length) {
      await tx
        .deleteFrom('course_nodes')
        .where('course_id', '=', courseId)
        .where('node_id', 'in', batch.deleteNodes)
        .execute();
      for (const id of batch.deleteNodes) kinds.delete(id);
    }
    for (const node of nodes) {
      const kind = kinds.get(node.id);
      if (kind && kind !== node.kind) throw badRequest('The kind of a node cannot change');
      await tx
        .insertInto('course_nodes')
        .values({
          course_id: courseId,
          node_id: node.id,
          kind: node.kind,
          doc: JSON.stringify(node),
          updated_by: userId,
        })
        .onConflict((oc) =>
          oc.columns(['course_id', 'node_id']).doUpdateSet((eb) => ({
            doc: JSON.stringify(node),
            rev: eb('course_nodes.rev', '+', 1),
            updated_at: new Date(),
            updated_by: userId,
          })),
        )
        .execute();
      kinds.set(node.id, node.kind);
    }

    const course = await tx
      .selectFrom('courses')
      .select('structure')
      .where('id', '=', courseId)
      .executeTakeFirstOrThrow();
    const structure =
      batch.structure !== undefined
        ? parseOr400(courseStructureSchema, batch.structure, 'structure')
        : course.structure;
    assertStructureMatches(structure, new Set(kinds.keys()));
    await tx
      .updateTable('courses')
      .set({
        structure: JSON.stringify(structure),
        ...(batch.title !== undefined ? { title: batch.title } : {}),
        ...(batch.meta !== undefined
          ? {
              meta: JSON.stringify({
                ...parseOr400(courseMetaSchema, batch.meta, 'course information'),
                updatedAt: new Date().toISOString(),
              }),
            }
          : {}),
        ...(batch.languages !== undefined
          ? { languages: JSON.stringify(parseOr400(courseLanguagesSchema, batch.languages, 'languages')) }
          : {}),
        ...(batch.settings !== undefined
          ? { settings: JSON.stringify(parseOr400(courseSettingsSchema, batch.settings, 'settings')) }
          : {}),
      })
      .where('id', '=', courseId)
      .execute();
    if (batch.settings !== undefined) await assertAssetsAttached(tx, courseId, batch.settings);
    const revs = await tx
      .selectFrom('course_nodes')
      .select(['node_id', 'rev'])
      .where('course_id', '=', courseId)
      .execute();
    return { rev, nodeRevs: Object.fromEntries(revs.map((n) => [n.node_id, n.rev])) };
  });
}
