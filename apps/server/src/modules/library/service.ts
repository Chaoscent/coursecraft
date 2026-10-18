// SPDX-License-Identifier: Apache-2.0
import { contentUrl } from '../../tenancy/origins.js';
import type { LibraryItem, PackageKind } from '@coursecraft/shared';
import { randomUUID } from 'node:crypto';
import type { AppContext, AuthState } from '../../http/context.js';
import { AppError, notFound } from '../../http/errors.js';
import { ZipArchive } from '../../lib/zip.js';
import { assertCourseEditor } from '../../policy/courses.js';
import { loadDocument } from '../courses/document.js';
import { createVersion } from '../courses/service.js';
import { likePattern } from '../users/repo.js';
import { buildExport } from '../exports/builder.js';
import { readManifest, type PackageManifest } from './manifest.js';
import { PACKAGE_LIMITS, PackageStore } from './packages.js';

export function packageStore(ctx: AppContext): PackageStore {
  return new PackageStore(ctx.blobs);
}

async function storePackage(
  ctx: AppContext,
  bytes: Buffer,
  meta: { kind?: PackageKind; userId: string; sourceCourseId?: string; sourceVersion?: number },
): Promise<{ id: string; manifest: PackageManifest }> {
  const zip = await ZipArchive.open(bytes, PACKAGE_LIMITS);
  const id = randomUUID();
  const store = packageStore(ctx);
  try {
    const manifest = await readManifest(zip);
    const size = await store.extract(id, zip);
    await ctx.db
      .insertInto('packages')
      .values({
        id,
        kind: meta.kind ?? manifest.kind,
        title: manifest.title,
        launch_path: manifest.launchPath,
        manifest: JSON.stringify(manifest),
        size,
        source_course_id: meta.sourceCourseId ?? null,
        source_version: meta.sourceVersion ?? null,
        created_by: meta.userId,
      })
      .execute();
    return { id, manifest };
  } catch (error) {
    await store.remove(id);
    throw error;
  } finally {
    zip.close();
  }
}

/** Imports a SCORM 1.2/2004, xAPI or cmi5 package as a new library item. */
export async function importPackage(ctx: AppContext, auth: AuthState, bytes: Buffer) {
  if (!contentUrl(ctx.config))
    throw new AppError('forbidden', 'Third-party packages need a content origin (COURSECRAFT_CONTENT_URL)');
  const { id: packageId, manifest } = await storePackage(ctx, bytes, { userId: auth.userId });
  const item = await ctx.db
    .insertInto('library_items')
    .values({ package_id: packageId, title: manifest.title, created_by: auth.userId })
    .returning('id')
    .executeTakeFirstOrThrow();
  await ctx.audit.record({
    actorUserId: auth.userId,
    action: 'library.imported',
    targetType: 'library_item',
    targetId: item.id,
    meta: { kind: manifest.kind },
  });
  return { id: item.id, kind: manifest.kind, title: manifest.title, multipleUnits: manifest.multipleUnits };
}

/**
 * Publishes the current state of a course: a new version is saved and built
 * as a cmi5 package. The course's library item then points to it; running
 * attempts keep the package they started with.
 */
export async function publishCourse(ctx: AppContext, auth: AuthState, courseId: string) {
  await assertCourseEditor(ctx.db, auth, courseId);
  if (!ctx.config.playerDir) throw new AppError('internal', 'Player bundle not available');
  const version = await createVersion(ctx.db, courseId, 'Library', auth.userId);
  const { course } = await loadDocument(ctx.db, courseId);
  const built = await buildExport(course, 'cmi5', ctx.assets, ctx.config.playerDir);
  const { id: packageId } = await storePackage(ctx, built.buffer, {
    kind: 'coursecraft',
    userId: auth.userId,
    sourceCourseId: courseId,
    sourceVersion: version,
  });
  const existing = await ctx.db
    .selectFrom('library_items')
    .select('id')
    .where('source_course_id', '=', courseId)
    .executeTakeFirst();
  let id: string;
  if (existing) {
    await ctx.db
      .updateTable('library_items')
      .set({ package_id: packageId, title: built.title, status: 'active', updated_at: new Date() })
      .where('id', '=', existing.id)
      .execute();
    id = existing.id;
  } else {
    id = (
      await ctx.db
        .insertInto('library_items')
        .values({
          package_id: packageId,
          title: built.title,
          source_course_id: courseId,
          created_by: auth.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }
  await ctx.audit.record({
    actorUserId: auth.userId,
    action: 'library.published',
    targetType: 'library_item',
    targetId: id,
    meta: { courseId, version },
  });
  return { id, version };
}

export async function listItems(
  ctx: AppContext,
  query: { status: 'active' | 'archived'; q?: string | undefined },
): Promise<LibraryItem[]> {
  let q = ctx.db
    .selectFrom('library_items')
    .innerJoin('packages', 'packages.id', 'library_items.package_id')
    .where('library_items.status', '=', query.status);
  if (query.q) q = q.where('library_items.title', 'ilike', likePattern(query.q));
  const rows = await q
    .select((eb) => [
      'library_items.id',
      'library_items.title',
      'library_items.description',
      'library_items.status',
      'library_items.source_course_id',
      'library_items.updated_at',
      'packages.kind',
      'packages.source_version',
      eb
        .selectFrom('assignments')
        .select((a) => a.fn.countAll<string>().as('n'))
        .whereRef('assignments.library_item_id', '=', 'library_items.id')
        .as('assignment_count'),
      eb
        .selectFrom('registrations')
        .select((r) => r.fn.count<string>('registrations.user_id').distinct().as('n'))
        .whereRef('registrations.library_item_id', '=', 'library_items.id')
        .as('learner_count'),
      eb
        .selectFrom('registrations')
        .select((r) => r.fn.count<string>('registrations.user_id').distinct().as('n'))
        .whereRef('registrations.library_item_id', '=', 'library_items.id')
        .where('registrations.completion', '=', 'completed')
        .as('completed_count'),
    ])
    .orderBy('library_items.title')
    .limit(1000)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    kind: r.kind,
    sourceCourseId: r.source_course_id,
    sourceVersion: r.source_version,
    assignmentCount: Number(r.assignment_count ?? 0),
    learnerCount: Number(r.learner_count ?? 0),
    completedCount: Number(r.completed_count ?? 0),
    updatedAt: r.updated_at.toISOString(),
  }));
}

export async function updateItem(
  ctx: AppContext,
  auth: AuthState,
  id: string,
  changes: {
    title?: string | undefined;
    description?: string | undefined;
    status?: 'active' | 'archived' | undefined;
  },
): Promise<void> {
  const result = await ctx.db
    .updateTable('library_items')
    .set({
      ...(changes.title !== undefined ? { title: changes.title } : {}),
      ...(changes.description !== undefined ? { description: changes.description } : {}),
      ...(changes.status !== undefined ? { status: changes.status } : {}),
      updated_at: new Date(),
    })
    .where('id', '=', id)
    .executeTakeFirst();
  if (!result.numUpdatedRows) throw notFound('Library item not found');
  await ctx.audit.record({
    actorUserId: auth.userId,
    action: 'library.updated',
    targetType: 'library_item',
    targetId: id,
    meta: { fields: Object.keys(changes) },
  });
}
