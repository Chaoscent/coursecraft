// SPDX-License-Identifier: Apache-2.0
import {
  CONVERTER_OUTPUT,
  QUEUES,
  type ConversionResponse,
  type ConvertDoneJob,
  type ImportWarning,
} from '@coursecraft/shared';
import { fileTypeFromBuffer } from 'file-type';
import { randomUUID } from 'node:crypto';
import type { AuthState, AppContext } from '../../http/context.js';
import { AppError, notFound } from '../../http/errors.js';
import { attachAssets, storeAsset, type StoredAsset } from '../assets/service.js';
import { insertCourse } from '../courses/document.js';
import { preparePresentation, withRenderedPages, type ImportPayload } from '../pptx/import.js';

/** Media formats the converter accepts as input (identified by content). */
const MEDIA_INPUT: Record<string, string> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/vnd.wave': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
};

const MAX_PAGE_BYTES = 30 * 1024 * 1024;

interface MediaResult {
  asset: StoredAsset;
  durationMs: number | null;
  webm?: StoredAsset | null;
  poster?: StoredAsset | null;
}

export async function getConversion(
  ctx: AppContext,
  auth: AuthState,
  id: string,
): Promise<ConversionResponse> {
  const row = await ctx.db
    .selectFrom('conversions')
    .select(['id', 'kind', 'status', 'error', 'created_at', 'course_id', 'result'])
    .where('id', '=', id)
    .where('created_by', '=', auth.userId)
    .executeTakeFirst();
  // Conversions are private to the user who started them.
  if (!row) throw notFound('Conversion not found');
  const result = row.result as { warnings?: ImportWarning[]; media?: MediaResult };
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    courseId: row.kind === 'pptx-import' ? row.course_id : null,
    warnings: result.warnings ?? [],
    asset: result.media
      ? {
          ...result.media.asset,
          durationMs: result.media.durationMs,
          webm: result.media.webm ?? null,
          poster: result.media.poster ?? null,
        }
      : null,
  };
}

/** Parses the presentation now and queues the slide rendering. */
export async function startPresentationImport(
  ctx: AppContext,
  auth: AuthState,
  bytes: Buffer,
  fileName: string,
  lang: string,
): Promise<string> {
  const payload = await preparePresentation(ctx.db, ctx.assets, bytes, {
    lang,
    fileName,
    userId: auth.userId,
  });
  const id = randomUUID();
  await ctx.db
    .insertInto('conversions')
    .values({
      id,
      kind: 'pptx-import',
      created_by: auth.userId,
      input_name: fileName,
      payload: JSON.stringify(payload),
    })
    .execute();
  try {
    ctx.work.prepare(id, 'source.pptx', bytes);
    await ctx.jobs.send(
      QUEUES.pptxRender,
      { jobId: id, widthPx: Math.min(3840, Math.round(payload.canvas.width * 1.5)) },
      { expireInSeconds: ctx.config.conversionTimeoutMinutes * 60 },
    );
  } catch (error) {
    // No work volume or job queue: the course is created without slide images.
    ctx.log.warn({ err: error, conversionId: id }, 'slide rendering not queued');
    ctx.work.remove(id);
    await finishImport(ctx, id, null, 'render_skipped');
  }
  return id;
}

/** Creates the course from a pending import; `pages` maps slide position → rendered image. */
async function finishImport(
  ctx: AppContext,
  id: string,
  pages: Map<number, StoredAsset> | null,
  warning?: ImportWarning['code'],
): Promise<string | null> {
  const courseId = await ctx.db.transaction().execute(async (tx) => {
    const row = await tx
      .selectFrom('conversions')
      .innerJoin('users', 'users.id', 'conversions.created_by')
      .select(['conversions.payload', 'conversions.created_by', 'users.display_name'])
      .where('conversions.id', '=', id)
      .where('conversions.status', '=', 'pending')
      .where('conversions.kind', '=', 'pptx-import')
      .forUpdate()
      .executeTakeFirst();
    if (!row) return null;
    const payload = row.payload as unknown as ImportPayload;
    const shas = new Map([...(pages ?? new Map<number, StoredAsset>())].map(([i, a]) => [i, a.sha256]));
    const nodes = withRenderedPages(payload, shas);
    const created = await insertCourse(
      tx,
      { id: row.created_by, displayName: row.display_name },
      { title: payload.title, lang: payload.lang, canvas: payload.canvas, chapters: payload.chapters, nodes },
    );
    await attachAssets(tx, created, [...payload.assets, ...(pages ? [...pages.values()] : [])]);
    const warnings = [...payload.warnings, ...(warning ? [{ code: warning }] : [])];
    await tx
      .updateTable('conversions')
      .set({
        status: 'done',
        course_id: created,
        finished_at: new Date(),
        payload: JSON.stringify({}),
        result: JSON.stringify({ warnings }),
      })
      .where('id', '=', id)
      .execute();
    await ctx.audit.record(
      {
        actorUserId: row.created_by,
        action: 'course.imported',
        targetType: 'course',
        targetId: created,
        meta: { slides: nodes.length, rendered: shas.size },
      },
      tx,
    );
    return created;
  });
  return courseId;
}

/** Creates the course without waiting for the slide images. */
export async function skipRendering(ctx: AppContext, auth: AuthState, id: string): Promise<void> {
  const row = await ctx.db
    .selectFrom('conversions')
    .select(['status', 'kind'])
    .where('id', '=', id)
    .where('created_by', '=', auth.userId)
    .executeTakeFirst();
  if (!row) throw notFound('Conversion not found');
  if (row.kind !== 'pptx-import' || row.status !== 'pending') return;
  await finishImport(ctx, id, null, 'render_skipped');
}

/** Stores a recording or media file in the work volume and queues its conversion. */
export async function startMediaConversion(
  ctx: AppContext,
  auth: AuthState,
  courseId: string,
  bytes: Buffer,
  name: string,
  options: {
    target: 'audio' | 'video';
    normalize: boolean;
    trimStartMs?: number | undefined;
    trimEndMs?: number | undefined;
  },
): Promise<string> {
  const { trimStartMs: startMs = 0, trimEndMs: endMs } = options;
  if (endMs !== undefined && endMs <= startMs)
    throw new AppError('bad_request', 'Trim end must be after start');
  const type = await fileTypeFromBuffer(bytes);
  const ext = type ? MEDIA_INPUT[type.mime] : undefined;
  if (!ext) throw new AppError('unsupported_media_type', 'Unsupported media format');
  const id = randomUUID();
  await ctx.db
    .insertInto('conversions')
    .values({
      id,
      kind: 'media',
      created_by: auth.userId,
      course_id: courseId,
      input_name: name,
      payload: JSON.stringify({ target: options.target }),
    })
    .execute();
  try {
    ctx.work.prepare(id, `source.${ext}`, bytes);
    await ctx.jobs.send(
      QUEUES.media,
      {
        jobId: id,
        target: options.target,
        normalize: options.normalize,
        ...(startMs > 0 || endMs !== undefined
          ? { trim: { startMs, ...(endMs !== undefined ? { endMs } : {}) } }
          : {}),
      },
      { expireInSeconds: ctx.config.conversionTimeoutMinutes * 60 },
    );
  } catch (error) {
    ctx.log.warn({ err: error, conversionId: id }, 'media conversion not queued');
    ctx.work.remove(id);
    await fail(ctx, id, 'unavailable');
    throw new AppError('internal', 'Media conversion is not available');
  }
  return id;
}

async function fail(ctx: AppContext, id: string, error: string): Promise<void> {
  await ctx.db
    .updateTable('conversions')
    .set({ status: 'failed', error, finished_at: new Date(), payload: JSON.stringify({}) })
    .where('id', '=', id)
    .where('status', '=', 'pending')
    .execute();
}

function pageIndex(name: string): number | null {
  if (!CONVERTER_OUTPUT.pdfPage.test(name)) return null;
  return Number.parseInt(name.slice(5, 9), 10) - 1;
}

async function ingestPages(ctx: AppContext, job: ConvertDoneJob, totalSlides: number, userId: string) {
  const pages = new Map<number, StoredAsset>();
  for (const name of ctx.work.outputs(job.jobId)) {
    const index = pageIndex(name);
    if (index === null || index < 0 || index >= totalSlides) continue;
    const bytes = ctx.work.readOutput(job.jobId, name, MAX_PAGE_BYTES);
    if (!bytes) continue;
    try {
      const asset = await storeAsset(ctx.db, ctx.assets, bytes, `slide-${index + 1}.png`, userId);
      if (asset.mime === 'image/png') pages.set(index, asset);
    } catch {
      // Not a valid image: the slide simply has no rendering.
    }
  }
  return pages;
}

async function ingestMedia(
  ctx: AppContext,
  job: ConvertDoneJob,
  row: { course_id: string | null; created_by: string; input_name: string; payload: Record<string, unknown> },
) {
  const target = row.payload['target'] === 'video' ? 'video' : 'audio';
  const file = target === 'audio' ? CONVERTER_OUTPUT.audio : CONVERTER_OUTPUT.videoMp4;
  const bytes = ctx.work.readOutput(job.jobId, file, ctx.config.uploadMaxMb * 1024 * 1024);
  if (!bytes || !row.course_id) return null;
  const base = row.input_name.replace(/\.[^.]+$/, '') || 'media';
  const asset = await storeAsset(
    ctx.db,
    ctx.assets,
    bytes,
    `${base}.${target === 'audio' ? 'm4a' : 'mp4'}`,
    row.created_by,
  );
  const expected = target === 'audio' ? 'audio/mp4' : 'video/mp4';
  if (asset.mime !== expected) return null;
  const extras = target === 'video' ? await ingestVideoExtras(ctx, job, base, row.created_by) : {};
  await attachAssets(ctx.db, row.course_id, [asset, ...Object.values(extras)]);
  return { asset, webm: extras.webm ?? null, poster: extras.poster ?? null };
}

/** Optional WebM alternative and poster frame; skipped when missing or not what they claim to be. */
async function ingestVideoExtras(ctx: AppContext, job: ConvertDoneJob, base: string, userId: string) {
  const extras: { webm?: StoredAsset; poster?: StoredAsset } = {};
  const files = [
    ['webm', CONVERTER_OUTPUT.videoWebm, 'video/webm', `${base}.webm`, ctx.config.uploadMaxMb * 1024 * 1024],
    ['poster', CONVERTER_OUTPUT.poster, 'image/png', `${base}.png`, MAX_PAGE_BYTES],
  ] as const;
  for (const [key, file, mime, name, limit] of files) {
    if (!job.outputs.includes(file)) continue;
    const bytes = ctx.work.readOutput(job.jobId, file, limit);
    if (!bytes) continue;
    try {
      const stored = await storeAsset(ctx.db, ctx.assets, bytes, name, userId);
      if (stored.mime === mime) extras[key] = stored;
    } catch {
      // Not a valid file: the video works without it.
    }
  }
  return extras;
}

/** Handles the converter's completion message. Outputs are validated before use. */
export async function handleConvertDone(ctx: AppContext, job: ConvertDoneJob): Promise<void> {
  try {
    const row = await ctx.db
      .selectFrom('conversions')
      .select(['kind', 'course_id', 'created_by', 'input_name', 'payload'])
      .where('id', '=', job.jobId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    if (!row) return;
    if (row.kind === 'pptx-import') {
      const payload = row.payload as unknown as ImportPayload;
      const pages = job.ok ? await ingestPages(ctx, job, payload.totalSlides, row.created_by) : new Map();
      await finishImport(ctx, job.jobId, pages, pages.size ? undefined : 'render_failed');
      return;
    }
    if (!job.ok) return await fail(ctx, job.jobId, job.error ?? 'failed');
    const media = await ingestMedia(ctx, job, row);
    if (!media) return await fail(ctx, job.jobId, 'failed');
    await ctx.db
      .updateTable('conversions')
      .set({
        status: 'done',
        finished_at: new Date(),
        payload: JSON.stringify({}),
        result: JSON.stringify({ media: { ...media, durationMs: job.durationMs ?? null } }),
      })
      .where('id', '=', job.jobId)
      .where('status', '=', 'pending')
      .execute();
  } finally {
    ctx.work.remove(job.jobId);
  }
}

/** Gives up conversions the converter never answered (not running, crashed, expired). */
export async function expireStale(ctx: AppContext): Promise<number> {
  const cutoff = new Date(Date.now() - ctx.config.conversionTimeoutMinutes * 60_000);
  const stale = await ctx.db
    .selectFrom('conversions')
    .select(['id', 'kind'])
    .where('status', '=', 'pending')
    .where('created_at', '<', cutoff)
    .execute();
  for (const row of stale) {
    if (row.kind === 'pptx-import') await finishImport(ctx, row.id, null, 'render_failed');
    else await fail(ctx, row.id, 'timeout');
    ctx.work.remove(row.id);
  }
  return stale.length;
}
