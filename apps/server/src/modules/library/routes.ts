// SPDX-License-Identifier: Apache-2.0
import {
  assignmentParamsSchema,
  assignmentsResponseSchema,
  createAssignmentsSchema,
  directoryQuerySchema,
  directoryResponseSchema,
  importPackageResponseSchema,
  libraryItemIdSchema,
  libraryListResponseSchema,
  libraryQuerySchema,
  okSchema,
  publishCourseSchema,
  updateLibraryItemSchema,
} from '@coursecraft/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../auth/plugin.js';
import type { AppContext } from '../../http/context.js';
import { AppError, badRequest } from '../../http/errors.js';
import { likePattern } from '../users/repo.js';
import { createAssignments, deleteAssignment, listAssignments } from './assignments.js';
import { importPackage, listItems, publishCourse, updateItem } from './service.js';

export function libraryRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/api/library',
    {
      config: { permission: 'library.view' },
      schema: { querystring: libraryQuerySchema, response: { 200: libraryListResponseSchema } },
    },
    async (request) => ({
      items: await listItems(ctx, request.query),
      foreignPackagesEnabled: !!ctx.config.contentUrl,
    }),
  );

  r.post(
    '/api/library/import',
    {
      config: { permission: 'library.manage', allowMultipart: true },
      schema: { response: { 200: importPackageResponseSchema } },
    },
    async (request) => {
      const auth = requireAuth(request);
      const file = await request.file();
      if (!file) throw badRequest('No file');
      let bytes: Buffer;
      try {
        bytes = await file.toBuffer();
      } catch {
        throw new AppError('payload_too_large', 'File is too large');
      }
      return importPackage(ctx, auth, bytes);
    },
  );

  r.post(
    '/api/library/publish',
    {
      config: { permission: 'courses.author' },
      schema: {
        body: publishCourseSchema,
        response: { 200: z.object({ id: z.uuid(), version: z.number().int() }) },
      },
    },
    async (request) => publishCourse(ctx, requireAuth(request), request.body.courseId),
  );

  r.patch(
    '/api/library/:id',
    {
      config: { permission: 'library.manage' },
      schema: { params: libraryItemIdSchema, body: updateLibraryItemSchema, response: { 200: okSchema } },
    },
    async (request) => {
      await updateItem(ctx, requireAuth(request), request.params.id, request.body);
      return { ok: true as const };
    },
  );

  // Minimal user directory for assigning (no user administration rights needed).
  r.get(
    '/api/directory/users',
    {
      config: { permission: 'assignments.manage' },
      schema: { querystring: directoryQuerySchema, response: { 200: directoryResponseSchema } },
    },
    async (request) => {
      let q = ctx.db
        .selectFrom('users')
        .select(['id', 'display_name', 'email'])
        .where('deleted_at', 'is', null)
        .where('status', '=', 'active');
      if (request.query.q)
        q = q.where((eb) =>
          eb.or([
            eb('display_name', 'ilike', likePattern(request.query.q)),
            eb('email', 'ilike', likePattern(request.query.q)),
          ]),
        );
      const rows = await q.orderBy('display_name').limit(50).execute();
      return { items: rows.map((u) => ({ id: u.id, displayName: u.display_name, email: u.email })) };
    },
  );

  r.get(
    '/api/library/:id/assignments',
    {
      config: { permission: 'assignments.manage' },
      schema: { params: libraryItemIdSchema, response: { 200: assignmentsResponseSchema } },
    },
    async (request) => ({ items: await listAssignments(ctx, request.params.id) }),
  );

  r.post(
    '/api/library/:id/assignments',
    {
      config: { permission: 'assignments.manage' },
      schema: {
        params: libraryItemIdSchema,
        body: createAssignmentsSchema,
        response: { 200: z.object({ count: z.number().int() }) },
      },
    },
    async (request) => ({
      count: await createAssignments(ctx, requireAuth(request), request.params.id, request.body),
    }),
  );

  r.delete(
    '/api/library/:id/assignments/:assignmentId',
    {
      config: { permission: 'assignments.manage' },
      schema: { params: assignmentParamsSchema, response: { 200: okSchema } },
    },
    async (request) => {
      await deleteAssignment(ctx, requireAuth(request), request.params.id, request.params.assignmentId);
      return { ok: true as const };
    },
  );
}
