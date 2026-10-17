// SPDX-License-Identifier: Apache-2.0
import {
  assignmentsResponseSchema,
  createAssignmentsSchema,
  idParamSchema,
  okSchema,
  pathAssignmentParamsSchema,
  pathDetailSchema,
  pathInputSchema,
  pathsResponseSchema,
} from '@coursecraft/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../auth/plugin.js';
import type { AppContext } from '../../http/context.js';
import {
  createPathAssignments,
  deletePath,
  deletePathAssignment,
  getPath,
  listPathAssignments,
  listPaths,
  savePath,
} from './service.js';

export function pathRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const view = { permission: 'library.view' as const };
  const manage = { permission: 'library.manage' as const };
  const assign = { permission: 'assignments.manage' as const };

  r.get('/api/paths', { config: view, schema: { response: { 200: pathsResponseSchema } } }, async () => ({
    items: await listPaths(ctx),
  }));

  r.get(
    '/api/paths/:id',
    { config: view, schema: { params: idParamSchema, response: { 200: pathDetailSchema } } },
    async (request) => getPath(ctx, request.params.id),
  );

  r.post(
    '/api/paths',
    { config: manage, schema: { body: pathInputSchema, response: { 200: pathDetailSchema } } },
    async (request) => getPath(ctx, await savePath(ctx, requireAuth(request), null, request.body)),
  );

  r.put(
    '/api/paths/:id',
    {
      config: manage,
      schema: { params: idParamSchema, body: pathInputSchema, response: { 200: pathDetailSchema } },
    },
    async (request) =>
      getPath(ctx, await savePath(ctx, requireAuth(request), request.params.id, request.body)),
  );

  r.delete(
    '/api/paths/:id',
    { config: manage, schema: { params: idParamSchema, response: { 200: okSchema } } },
    async (request) => {
      await deletePath(ctx, requireAuth(request), request.params.id);
      return { ok: true as const };
    },
  );

  r.get(
    '/api/paths/:id/assignments',
    { config: assign, schema: { params: idParamSchema, response: { 200: assignmentsResponseSchema } } },
    async (request) => ({ items: await listPathAssignments(ctx, request.params.id) }),
  );

  r.post(
    '/api/paths/:id/assignments',
    {
      config: assign,
      schema: {
        params: idParamSchema,
        body: createAssignmentsSchema,
        response: { 200: z.object({ count: z.number() }) },
      },
    },
    async (request) => ({
      count: await createPathAssignments(ctx, requireAuth(request), request.params.id, request.body),
    }),
  );

  r.delete(
    '/api/paths/:id/assignments/:assignmentId',
    { config: assign, schema: { params: pathAssignmentParamsSchema, response: { 200: okSchema } } },
    async (request) => {
      await deletePathAssignment(ctx, requireAuth(request), request.params.id, request.params.assignmentId);
      return { ok: true as const };
    },
  );
}
