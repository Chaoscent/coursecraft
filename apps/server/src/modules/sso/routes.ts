// SPDX-License-Identifier: Apache-2.0
import {
  idParamSchema,
  okSchema,
  publicSsoProvidersSchema,
  ssoProviderInputSchema,
  ssoProvidersResponseSchema,
} from '@coursecraft/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../auth/plugin.js';
import type { AppContext } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { startSession } from '../auth/routes.js';
import {
  deleteProvider,
  finishOidc,
  listProviders,
  publicProviders,
  saveProvider,
  startOidc,
  type Outcome,
} from './service.js';

export function ssoRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const rate = { max: ctx.config.loginRateLimit, timeWindow: '1 minute' };
  const admin = { permission: 'settings.manage' as const };

  /** Ends a browser navigation: signed in and home, or the login page with a reason. */
  const conclude = async (
    request: Parameters<typeof startSession>[1],
    reply: FastifyReply,
    outcome: Outcome,
  ) => {
    if ('error' in outcome) {
      await ctx.audit.record({
        actorUserId: null,
        action: 'auth.sso_failed',
        meta: { reason: outcome.error },
        ipHmac: request.ipHmac,
      });
      return reply.redirect(`/login?sso_error=${outcome.error}`);
    }
    await startSession(ctx, request, reply, outcome.userId);
    await ctx.audit.record({
      actorUserId: outcome.userId,
      action: 'auth.login',
      meta: { sso: true },
      ipHmac: request.ipHmac,
    });
    return reply.redirect('/');
  };

  r.get(
    '/api/auth/sso/providers',
    { config: { permission: 'public' }, schema: { response: { 200: publicSsoProvidersSchema } } },
    async () => ({ items: await publicProviders(ctx) }),
  );

  r.get(
    '/api/auth/sso/callback',
    {
      config: { permission: 'public', rateLimit: rate },
      schema: {
        querystring: z.object({
          state: z.string().max(200).optional(),
          error: z.string().max(200).optional(),
        }),
      },
    },
    async (request, reply) => conclude(request, reply, await finishOidc(ctx, request, reply)),
  );

  r.get(
    '/api/auth/sso/:id/start',
    { config: { permission: 'public', rateLimit: rate }, schema: { params: idParamSchema } },
    async (request, reply) => {
      try {
        return reply.redirect(await startOidc(ctx, reply, request.params.id));
      } catch (error) {
        if (!(error instanceof AppError)) ctx.log.warn({ err: error }, 'single sign-on could not start');
        return reply.redirect('/login?sso_error=failed');
      }
    },
  );

  r.get(
    '/api/sso/providers',
    { config: admin, schema: { response: { 200: ssoProvidersResponseSchema } } },
    async () => ({
      items: await listProviders(ctx),
    }),
  );

  r.post(
    '/api/sso/providers',
    { config: admin, schema: { body: ssoProviderInputSchema, response: { 200: idParamSchema } } },
    async (request) => ({ id: await saveProvider(ctx, requireAuth(request), null, request.body) }),
  );

  r.put(
    '/api/sso/providers/:id',
    {
      config: admin,
      schema: { params: idParamSchema, body: ssoProviderInputSchema, response: { 200: idParamSchema } },
    },
    async (request) => ({
      id: await saveProvider(ctx, requireAuth(request), request.params.id, request.body),
    }),
  );

  r.delete(
    '/api/sso/providers/:id',
    { config: admin, schema: { params: idParamSchema, response: { 200: okSchema } } },
    async (request) => {
      await deleteProvider(ctx, requireAuth(request), request.params.id);
      return { ok: true as const };
    },
  );
}
