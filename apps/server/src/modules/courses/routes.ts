// SPDX-License-Identifier: Apache-2.0
import {
  addNodeRequestSchema,
  assetParamsSchema,
  assetSchema,
  courseDocumentResponseSchema,
  courseMembersResponseSchema,
  createCourseRequestSchema,
  createVersionRequestSchema,
  exportQuerySchema,
  idParamSchema,
  listCoursesQuerySchema,
  listCoursesResponseSchema,
  listVersionsResponseSchema,
  lockResponseSchema,
  nodeParamsSchema,
  nodeRevResponseSchema,
  okSchema,
  revResponseSchema,
  saveCourseRequestSchema,
  saveCourseResponseSchema,
  setCourseMembersRequestSchema,
  updateCourseRequestSchema,
  updateNodeRequestSchema,
  versionParamsSchema,
} from '@lernwerk/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../auth/plugin.js';
import type { AppContext } from '../../http/context.js';
import { AppError, badRequest, forbidden, notFound } from '../../http/errors.js';
import { assertCourseEditor, editableCourseIds } from '../../policy/courses.js';
import { likePattern } from '../users/repo.js';
import { attachAssets, displayName, storeAsset } from '../assets/service.js';
import type { AssetStore } from '../assets/store.js';
import { EXTENSIONS } from '../assets/store.js';
import { buildExport } from '../exports/builder.js';
import { createCourse, loadDocument } from './document.js';
import { acquireLock, assertLockHeld, breakLock, currentLock, releaseLock } from './locks.js';
import {
  addNode,
  createVersion,
  deleteNode,
  restoreVersion,
  saveBatch,
  updateCourse,
  updateNode,
} from './service.js';

const SORT = { title: 'courses.title', updated: 'courses.updated_at' } as const;

export function courseRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  store: AssetStore,
  playerDir: string | undefined,
): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const config = { permission: 'courses.author' as const };

  r.get(
    '/api/courses',
    { config, schema: { querystring: listCoursesQuerySchema, response: { 200: listCoursesResponseSchema } } },
    async (request) => {
      const auth = requireAuth(request);
      const { q, status, sort, dir } = request.query;
      let query = ctx.db
        .selectFrom('courses')
        .innerJoin('users', 'users.id', 'courses.owner_id')
        .leftJoin('course_locks', 'course_locks.course_id', 'courses.id')
        .leftJoin('users as lockers', 'lockers.id', 'course_locks.user_id')
        .where('courses.status', '=', status);
      const allowed = editableCourseIds(ctx.db, auth);
      if (allowed) query = query.where('courses.id', 'in', allowed);
      if (q) query = query.where('courses.title', 'ilike', likePattern(q));
      const rows = await query
        .select((eb) => [
          'courses.id',
          'courses.title',
          'courses.status',
          'courses.owner_id',
          'courses.updated_at',
          'users.display_name as owner_name',
          'lockers.display_name as locker_name',
          'course_locks.heartbeat_at',
          eb
            .selectFrom('course_nodes')
            .select((n) => n.fn.countAll<string>().as('c'))
            .whereRef('course_nodes.course_id', '=', 'courses.id')
            .as('node_count'),
        ])
        .orderBy(SORT[sort], dir)
        .limit(500)
        .execute();
      return {
        items: rows.map((c) => ({
          id: c.id,
          title: c.title,
          status: c.status,
          ownerId: c.owner_id,
          ownerName: c.owner_name,
          updatedAt: c.updated_at.toISOString(),
          nodeCount: Number(c.node_count ?? 0),
          lockedBy: c.heartbeat_at && Date.now() - c.heartbeat_at.getTime() < 60_000 ? c.locker_name : null,
        })),
      };
    },
  );

  r.post(
    '/api/courses',
    { config, schema: { body: createCourseRequestSchema, response: { 200: z.object({ id: z.uuid() }) } } },
    async (request) => {
      const auth = requireAuth(request);
      const id = await createCourse(
        ctx.db,
        { id: auth.userId, displayName: auth.displayName },
        request.body.title,
        request.body.language,
      );
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'course.created',
        targetType: 'course',
        targetId: id,
        ipHmac: request.ipHmac,
      });
      return { id };
    },
  );

  r.get(
    '/api/courses/:id',
    { config, schema: { params: idParamSchema, response: { 200: courseDocumentResponseSchema } } },
    async (request) => {
      const auth = requireAuth(request);
      const access = await assertCourseEditor(ctx.db, auth, request.params.id);
      const doc = await loadDocument(ctx.db, request.params.id);
      return {
        ...doc,
        lock: await currentLock(ctx.db, request.params.id, auth),
        canManage: access.canManage,
      };
    },
  );

  r.patch(
    '/api/courses/:id',
    {
      config,
      schema: {
        params: idParamSchema,
        body: updateCourseRequestSchema,
        response: { 200: revResponseSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      await assertCourseEditor(ctx.db, auth, request.params.id);
      await assertLockHeld(ctx.db, request.params.id, auth);
      return { rev: await updateCourse(ctx.db, request.params.id, request.body) };
    },
  );

  r.delete(
    '/api/courses/:id',
    { config, schema: { params: idParamSchema, response: { 200: okSchema } } },
    async (request) => {
      const auth = requireAuth(request);
      const access = await assertCourseEditor(ctx.db, auth, request.params.id);
      if (!access.canManage) throw forbidden('Only the owner or an administrator can archive a course');
      await ctx.db
        .updateTable('courses')
        .set({ status: 'archived', updated_at: new Date() })
        .where('id', '=', request.params.id)
        .execute();
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'course.archived',
        targetType: 'course',
        targetId: request.params.id,
        ipHmac: request.ipHmac,
      });
      return { ok: true as const };
    },
  );

  r.post(
    '/api/courses/:id/save',
    {
      config,
      bodyLimit: 16 * 1024 * 1024,
      schema: {
        params: idParamSchema,
        body: saveCourseRequestSchema,
        response: { 200: saveCourseResponseSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      await assertCourseEditor(ctx.db, auth, request.params.id);
      await assertLockHeld(ctx.db, request.params.id, auth);
      return saveBatch(ctx.db, request.params.id, request.body, auth.userId);
    },
  );

  r.post(
    '/api/courses/:id/nodes',
    {
      config,
      schema: { params: idParamSchema, body: addNodeRequestSchema, response: { 200: nodeRevResponseSchema } },
    },
    async (request) => {
      const auth = requireAuth(request);
      await assertCourseEditor(ctx.db, auth, request.params.id);
      await assertLockHeld(ctx.db, request.params.id, auth);
      return addNode(ctx.db, request.params.id, request.body, auth.userId);
    },
  );

  r.put(
    '/api/courses/:id/nodes/:nodeId',
    {
      config,
      bodyLimit: 8 * 1024 * 1024,
      schema: {
        params: nodeParamsSchema,
        body: updateNodeRequestSchema,
        response: { 200: z.object({ nodeRev: z.number().int() }) },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      await assertCourseEditor(ctx.db, auth, request.params.id);
      await assertLockHeld(ctx.db, request.params.id, auth);
      return {
        nodeRev: await updateNode(
          ctx.db,
          request.params.id,
          request.params.nodeId,
          request.body,
          auth.userId,
        ),
      };
    },
  );

  r.delete(
    '/api/courses/:id/nodes/:nodeId',
    {
      config,
      schema: {
        params: nodeParamsSchema,
        querystring: z.object({ rev: z.coerce.number().int() }),
        response: { 200: revResponseSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      await assertCourseEditor(ctx.db, auth, request.params.id);
      await assertLockHeld(ctx.db, request.params.id, auth);
      return { rev: await deleteNode(ctx.db, request.params.id, request.params.nodeId, request.query.rev) };
    },
  );

  r.post(
    '/api/courses/:id/lock',
    { config, schema: { params: idParamSchema, response: { 200: lockResponseSchema } } },
    async (request) => {
      const auth = requireAuth(request);
      await assertCourseEditor(ctx.db, auth, request.params.id);
      const acquired = await acquireLock(ctx.db, request.params.id, auth);
      return { acquired, lock: await currentLock(ctx.db, request.params.id, auth) };
    },
  );

  r.delete(
    '/api/courses/:id/lock',
    { config, schema: { params: idParamSchema, response: { 200: okSchema } } },
    async (request) => {
      const auth = requireAuth(request);
      await assertCourseEditor(ctx.db, auth, request.params.id);
      await releaseLock(ctx.db, request.params.id, auth);
      return { ok: true as const };
    },
  );

  r.post(
    '/api/courses/:id/lock/break',
    { config, schema: { params: idParamSchema, response: { 200: okSchema } } },
    async (request) => {
      const auth = requireAuth(request);
      const access = await assertCourseEditor(ctx.db, auth, request.params.id);
      if (!access.canManage) throw forbidden('Only the owner or an administrator can break the lock');
      await breakLock(ctx.db, request.params.id);
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'course.lock_broken',
        targetType: 'course',
        targetId: request.params.id,
        ipHmac: request.ipHmac,
      });
      return { ok: true as const };
    },
  );

  r.post(
    '/api/courses/:id/assets',
    {
      config: { ...config, allowMultipart: true },
      schema: { params: idParamSchema, response: { 200: assetSchema } },
    },
    async (request) => {
      const auth = requireAuth(request);
      await assertCourseEditor(ctx.db, auth, request.params.id);
      const file = await request.file();
      if (!file) throw badRequest('No file');
      let bytes: Buffer;
      try {
        bytes = await file.toBuffer();
      } catch {
        throw new AppError('payload_too_large', 'File is too large');
      }
      const asset = await storeAsset(ctx.db, store, bytes, displayName(file.filename), auth.userId);
      await attachAssets(ctx.db, request.params.id, [asset]);
      return asset;
    },
  );

  r.get(
    '/api/courses/:id/assets/:sha256',
    { config, schema: { params: assetParamsSchema } },
    async (request, reply) => {
      const auth = requireAuth(request);
      await assertCourseEditor(ctx.db, auth, request.params.id);
      const asset = await ctx.db
        .selectFrom('course_assets')
        .innerJoin('assets', 'assets.sha256', 'course_assets.sha256')
        .select(['assets.mime', 'course_assets.name'])
        .where('course_assets.course_id', '=', request.params.id)
        .where('course_assets.sha256', '=', request.params.sha256)
        .executeTakeFirst();
      if (!asset || !store.has(request.params.sha256)) throw notFound('File not found');
      return sendAsset(reply, store, request.params.sha256, asset.mime, request.headers.range);
    },
  );

  r.get(
    '/api/courses/:id/versions',
    { config, schema: { params: idParamSchema, response: { 200: listVersionsResponseSchema } } },
    async (request) => {
      const auth = requireAuth(request);
      await assertCourseEditor(ctx.db, auth, request.params.id);
      const rows = await ctx.db
        .selectFrom('course_versions')
        .leftJoin('users', 'users.id', 'course_versions.created_by')
        .select([
          'course_versions.id',
          'course_versions.number',
          'course_versions.note',
          'course_versions.created_at',
          'users.display_name',
        ])
        .where('course_versions.course_id', '=', request.params.id)
        .orderBy('course_versions.number', 'desc')
        .execute();
      return {
        items: rows.map((v) => ({
          id: v.id,
          number: v.number,
          note: v.note,
          createdAt: v.created_at.toISOString(),
          createdByName: v.display_name,
        })),
      };
    },
  );

  r.post(
    '/api/courses/:id/versions',
    {
      config,
      schema: {
        params: idParamSchema,
        body: createVersionRequestSchema,
        response: { 200: z.object({ number: z.number().int() }) },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      await assertCourseEditor(ctx.db, auth, request.params.id);
      return { number: await createVersion(ctx.db, request.params.id, request.body.note, auth.userId) };
    },
  );

  r.post(
    '/api/courses/:id/versions/:versionId/restore',
    { config, schema: { params: versionParamsSchema, response: { 200: revResponseSchema } } },
    async (request) => {
      const auth = requireAuth(request);
      await assertCourseEditor(ctx.db, auth, request.params.id);
      await assertLockHeld(ctx.db, request.params.id, auth);
      const rev = await restoreVersion(ctx.db, request.params.id, request.params.versionId, auth.userId);
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'course.version_restored',
        targetType: 'course',
        targetId: request.params.id,
        ipHmac: request.ipHmac,
      });
      return { rev };
    },
  );

  r.get(
    '/api/courses/:id/members',
    { config, schema: { params: idParamSchema, response: { 200: courseMembersResponseSchema } } },
    async (request) => {
      const auth = requireAuth(request);
      await assertCourseEditor(ctx.db, auth, request.params.id);
      const rows = await ctx.db
        .selectFrom('course_members')
        .innerJoin('users', 'users.id', 'course_members.user_id')
        .select(['users.id', 'users.display_name', 'users.email'])
        .where('course_members.course_id', '=', request.params.id)
        .orderBy('users.display_name')
        .execute();
      return { items: rows.map((u) => ({ userId: u.id, displayName: u.display_name, email: u.email })) };
    },
  );

  r.put(
    '/api/courses/:id/members',
    {
      config,
      schema: { params: idParamSchema, body: setCourseMembersRequestSchema, response: { 200: okSchema } },
    },
    async (request) => {
      const auth = requireAuth(request);
      const access = await assertCourseEditor(ctx.db, auth, request.params.id);
      if (!access.canManage) throw forbidden('Only the owner or an administrator can change co-authors');
      const ids = [...new Set(request.body.userIds)].filter((id) => id !== access.ownerId);
      if (ids.length) {
        const authors = await ctx.db
          .selectFrom('user_roles')
          .select('user_id')
          .where('user_id', 'in', ids)
          .where('role', 'in', ['author', 'admin'])
          .execute();
        if (new Set(authors.map((a) => a.user_id)).size !== ids.length)
          throw badRequest('Co-authors need the author role');
      }
      await ctx.db.transaction().execute(async (tx) => {
        await tx.deleteFrom('course_members').where('course_id', '=', request.params.id).execute();
        if (ids.length)
          await tx
            .insertInto('course_members')
            .values(ids.map((user_id) => ({ course_id: request.params.id, user_id })))
            .execute();
      });
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'course.members_changed',
        targetType: 'course',
        targetId: request.params.id,
        meta: { count: ids.length },
        ipHmac: request.ipHmac,
      });
      return { ok: true as const };
    },
  );

  r.get(
    '/api/courses/:id/export',
    { config, schema: { params: idParamSchema, querystring: exportQuerySchema } },
    async (request, reply) => {
      const auth = requireAuth(request);
      await assertCourseEditor(ctx.db, auth, request.params.id);
      if (!playerDir) throw new AppError('internal', 'Player bundle is not available');
      const { course } = await loadDocument(ctx.db, request.params.id);
      const zip = await buildExport(course, request.query.format, store, playerDir);
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'course.exported',
        targetType: 'course',
        targetId: request.params.id,
        meta: { format: request.query.format },
        ipHmac: request.ipHmac,
      });
      const safeTitle =
        zip.title
          .replace(/[^\p{L}\p{N}_-]+/gu, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60) || 'course';
      return reply
        .header('Content-Type', 'application/zip')
        .header(
          'Content-Disposition',
          `attachment; filename="${encodeURIComponent(safeTitle)}-${request.query.format}.zip"`,
        )
        .send(zip.buffer);
    },
  );
}

/** Streams a stored file; supports byte ranges (needed for media seeking). */
export function sendAsset(
  reply: FastifyReply,
  store: AssetStore,
  sha256: string,
  mime: string,
  rangeHeader: string | undefined,
) {
  const size = store.size(sha256);
  void reply
    .header('Content-Type', mime)
    .header('Accept-Ranges', 'bytes')
    .header('Cache-Control', 'private, max-age=3600');
  void reply.header('Content-Disposition', `inline; filename="${sha256}.${EXTENSIONS[mime] ?? 'bin'}"`);
  if (mime === 'image/svg+xml')
    void reply.header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
  const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader) : null;
  if (match && (match[1] || match[2])) {
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      return reply.status(416).header('Content-Range', `bytes */${size}`).send();
    }
    return reply
      .status(206)
      .header('Content-Range', `bytes ${start}-${end}/${size}`)
      .header('Content-Length', String(end - start + 1))
      .send(store.open(sha256, { start, end }));
  }
  return reply.header('Content-Length', String(size)).send(store.open(sha256));
}
