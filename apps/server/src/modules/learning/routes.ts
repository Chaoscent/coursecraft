// SPDX-License-Identifier: Apache-2.0
import {
  launchParamsSchema,
  launchRequestSchema,
  launchResponseSchema,
  libraryItemIdSchema,
  myItemsResponseSchema,
  okSchema,
  scormCommitSchema,
} from '@lernwerk/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireAuth } from '../../auth/plugin.js';
import type { AppContext } from '../../http/context.js';
import { endLaunch, heartbeat, launch, myItems, scormCommit } from './service.js';

export function learningRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const config = { permission: 'learning.participate' as const };

  r.get(
    '/api/learn/items',
    { config, schema: { response: { 200: myItemsResponseSchema } } },
    async (request) => ({
      items: await myItems(ctx, requireAuth(request)),
    }),
  );

  r.post(
    '/api/learn/items/:id/launch',
    {
      config,
      schema: {
        params: libraryItemIdSchema,
        body: launchRequestSchema,
        response: { 200: launchResponseSchema },
      },
    },
    async (request) => launch(ctx, requireAuth(request), request.params.id, request.body.newAttempt),
  );

  r.post(
    '/api/learn/launches/:launchId/heartbeat',
    { config, schema: { params: launchParamsSchema, response: { 200: okSchema } } },
    async (request) => {
      await heartbeat(ctx, requireAuth(request), request.params.launchId);
      return { ok: true as const };
    },
  );

  r.post(
    '/api/learn/launches/:launchId/end',
    { config, schema: { params: launchParamsSchema, response: { 200: okSchema } } },
    async (request) => {
      await endLaunch(ctx, requireAuth(request), request.params.launchId);
      return { ok: true as const };
    },
  );

  r.post(
    '/api/learn/launches/:launchId/scorm',
    { config, schema: { params: launchParamsSchema, body: scormCommitSchema, response: { 200: okSchema } } },
    async (request) => {
      await scormCommit(
        ctx,
        requireAuth(request),
        request.params.launchId,
        request.body.cmi,
        request.body.finished,
      );
      return { ok: true as const };
    },
  );
}
