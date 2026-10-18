// SPDX-License-Identifier: Apache-2.0
import { QUEUES, type ExportJob, type ExportStatus } from '@coursecraft/shared';
import { createReadStream, createWriteStream, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AppContext, AuthState } from '../../http/context.js';
import { AppError, notFound } from '../../http/errors.js';
import { assertCourseEditor } from '../../policy/courses.js';
import { storagePrefix } from '../../tenancy/origins.js';
import { assertStorageQuota } from '../../tenancy/quotas.js';
import { loadDocument } from '../courses/document.js';
import { exportFileName, streamExport, type ExportFormat } from './builder.js';

/** Finished archives stay this long; then the periodic cleanup removes them. */
export const EXPORT_KEEP_MS = 24 * 3_600_000;

const keyOf = (id: string) => `${storagePrefix()}exports/${id}.zip`;

type Row = {
  id: string;
  status: 'pending' | 'done' | 'failed';
  error: string | null;
  file_name: string | null;
  size: string | null;
  created_at: Date;
};

const toStatus = (r: Row): ExportStatus => ({
  id: r.id,
  status: r.status,
  error: r.error,
  fileName: r.file_name,
  size: r.size === null ? null : Number(r.size),
  createdAt: r.created_at.toISOString(),
});

/** Queues an export; the archive is built by a background job (no request time limit, no memory peak). */
export async function startExport(
  ctx: AppContext,
  auth: AuthState,
  courseId: string,
  format: ExportFormat,
): Promise<ExportStatus> {
  await assertCourseEditor(ctx.db, auth, courseId);
  if (!ctx.config.playerDir) throw new AppError('internal', 'Player bundle is not available');
  const row = await ctx.db
    .insertInto('course_exports')
    .values({ course_id: courseId, format, created_by: auth.userId })
    .returning(['id', 'status', 'error', 'file_name', 'size', 'created_at'])
    .executeTakeFirstOrThrow();
  await ctx.jobs.send(QUEUES.exportBuild, { exportId: row.id }, { expireInSeconds: 3600 });
  await ctx.audit.record({
    actorUserId: auth.userId,
    action: 'course.exported',
    targetType: 'course',
    targetId: courseId,
    meta: { format, background: true },
  });
  return toStatus(row);
}

/** The export, for the people who may edit its course. */
export async function exportStatus(
  ctx: AppContext,
  auth: AuthState,
  id: string,
): Promise<ExportStatus & { courseId: string }> {
  const row = await ctx.db
    .selectFrom('course_exports')
    .select(['id', 'course_id', 'status', 'error', 'file_name', 'size', 'created_at'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw notFound('Export not found');
  await assertCourseEditor(ctx.db, auth, row.course_id);
  return { ...toStatus(row), courseId: row.course_id };
}

export async function exportDownload(
  ctx: AppContext,
  auth: AuthState,
  id: string,
): Promise<{ stream: Readable; fileName: string; size: number }> {
  const status = await exportStatus(ctx, auth, id);
  if (status.status !== 'done' || !status.fileName || status.size === null)
    throw notFound('Export not ready');
  return { stream: await ctx.blobs.read(keyOf(id)), fileName: status.fileName, size: status.size };
}

/**
 * Job handler: builds the archive into a scratch file first (object storage
 * needs the length up front), then stores it. Any failure ends in a "failed"
 * export with a short reason; the course is never touched.
 */
export async function handleExportJob(ctx: AppContext, job: ExportJob): Promise<void> {
  const row = await ctx.db
    .selectFrom('course_exports')
    .select(['id', 'course_id', 'format', 'status'])
    .where('id', '=', job.exportId)
    .executeTakeFirst();
  if (!row || row.status !== 'pending') return;
  const scratch = mkdtempSync(join(tmpdir(), 'cc-export-'));
  try {
    const { course } = await loadDocument(ctx.db, row.course_id);
    const format = row.format as ExportFormat;
    const built = await streamExport(course, format, ctx.assets, ctx.config.playerDir ?? '');
    const file = join(scratch, 'export.zip');
    await pipeline(built.stream, createWriteStream(file));
    const size = statSync(file).size;
    await assertStorageQuota(ctx, size);
    await ctx.blobs.put(keyOf(row.id), { stream: createReadStream(file), size });
    await ctx.db
      .updateTable('course_exports')
      .set({
        status: 'done',
        size,
        file_name: exportFileName(built.title, format),
        finished_at: new Date(),
      })
      .where('id', '=', row.id)
      .execute();
  } catch (error) {
    ctx.log.warn({ err: error, exportId: row.id }, 'export failed');
    await ctx.db
      .updateTable('course_exports')
      .set({
        status: 'failed',
        error: error instanceof AppError ? error.message.slice(0, 300) : 'The export could not be built',
        finished_at: new Date(),
      })
      .where('id', '=', row.id)
      .execute();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Removes archives older than a day, and gives up exports that never ran. */
export async function purgeExports(ctx: AppContext): Promise<number> {
  const old = await ctx.db
    .selectFrom('course_exports')
    .select(['id'])
    .where('created_at', '<', new Date(Date.now() - EXPORT_KEEP_MS))
    .execute();
  for (const { id } of old) {
    await ctx.blobs.remove(keyOf(id));
    await ctx.db.deleteFrom('course_exports').where('id', '=', id).execute();
  }
  return old.length;
}
