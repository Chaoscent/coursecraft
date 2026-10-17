// SPDX-License-Identifier: Apache-2.0
import {
  aiPreviewRequestSchema,
  aiPreviewSchema,
  aiProviderInputSchema,
  aiProvidersResponseSchema,
  aiRunRequestSchema,
  aiRunResponseSchema,
  aiStatusSchema,
  aiUserKeyInputSchema,
  idParamSchema,
  okSchema,
} from '@lernwerk/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireAuth } from '../../auth/plugin.js';
import type { AppContext } from '../../http/context.js';
import { deleteProvider, listProviders, preview, run, saveProvider, setUserKey, status } from './service.js';

export function aiRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  // Per user, not per address: AI requests cost money.
  const perUser = {
    max: ctx.config.aiRateLimit,
    timeWindow: '1 minute',
    keyGenerator: (request: FastifyRequest) => request.auth?.userId ?? request.ipHmac,
  };

  r.get(
    '/api/ai/status',
    { config: { permission: 'ai.use' }, schema: { response: { 200: aiStatusSchema } } },
    async (request) => status(ctx, requireAuth(request)),
  );

  r.post(
    '/api/ai/preview',
    {
      config: { permission: 'ai.use', rateLimit: perUser },
      schema: { body: aiPreviewRequestSchema, response: { 200: aiPreviewSchema } },
    },
    async (request) => preview(ctx, requireAuth(request), request.body),
  );

  r.post(
    '/api/ai/run',
    {
      config: { permission: 'ai.use', rateLimit: perUser },
      schema: { body: aiRunRequestSchema, response: { 200: aiRunResponseSchema } },
    },
    async (request) => run(ctx, requireAuth(request), request.body.previewId),
  );

  r.put(
    '/api/ai/providers/:id/key',
    {
      config: { permission: 'ai.use', rateLimit: perUser },
      schema: { params: idParamSchema, body: aiUserKeyInputSchema, response: { 200: okSchema } },
    },
    async (request) => {
      await setUserKey(ctx, requireAuth(request), request.params.id, request.body.key);
      return { ok: true as const };
    },
  );

  r.get(
    '/api/ai/providers',
    { config: { permission: 'settings.manage' }, schema: { response: { 200: aiProvidersResponseSchema } } },
    async () => listProviders(ctx),
  );

  r.post(
    '/api/ai/providers',
    {
      config: { permission: 'settings.manage' },
      schema: { body: aiProviderInputSchema, response: { 200: idParamSchema } },
    },
    async (request) => ({ id: await saveProvider(ctx, requireAuth(request), null, request.body) }),
  );

  r.patch(
    '/api/ai/providers/:id',
    {
      config: { permission: 'settings.manage' },
      schema: { params: idParamSchema, body: aiProviderInputSchema, response: { 200: idParamSchema } },
    },
    async (request) => ({
      id: await saveProvider(ctx, requireAuth(request), request.params.id, request.body),
    }),
  );

  r.delete(
    '/api/ai/providers/:id',
    {
      config: { permission: 'settings.manage' },
      schema: { params: idParamSchema, response: { 200: okSchema } },
    },
    async (request) => {
      await deleteProvider(ctx, requireAuth(request), request.params.id);
      return { ok: true as const };
    },
  );
}
