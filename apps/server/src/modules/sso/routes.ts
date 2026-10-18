// SPDX-License-Identifier: Apache-2.0
import {
  idParamSchema,
  directorySyncResultSchema,
  ldapLoginRequestSchema,
  loginResponseSchema,
  okSchema,
  publicSsoProvidersSchema,
  ssoPolicySchema,
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
import { ldapLogin } from './ldap.js';
import { getSsoPolicy, saveSsoPolicy } from './policy.js';
import { proxyLogin } from './proxy.js';
import { syncDirectory } from './sync.js';
import {
  deleteProvider,
  finishOidc,
  finishSaml,
  listProviders,
  publicProviders,
  saveProvider,
  providerMetadata,
  startLogin,
  BINDER_COOKIE,
  sealLogout,
  enabledProvider,
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
    await startSession(
      ctx,
      request,
      reply,
      outcome.userId,
      outcome.providerId
        ? {
            providerId: outcome.providerId,
            logout: outcome.logout ? sealLogout(ctx, outcome.userId, outcome.logout) : null,
          }
        : undefined,
    );
    await ctx.audit.record({
      actorUserId: outcome.userId,
      action: 'auth.login',
      meta: { sso: true },
      ipHmac: request.ipHmac,
    });
    return reply.redirect('/');
  };

  // The provider's answer to a SAML logout request: the session here is already gone.
  r.get('/api/auth/sso/saml/logout', { config: { permission: 'public' } }, async (_request, reply) =>
    reply.redirect('/login'),
  );

  r.get(
    '/api/auth/sso/providers',
    { config: { permission: 'public' }, schema: { response: { 200: publicSsoProvidersSchema } } },
    async () => ({ items: await publicProviders(ctx) }),
  );

  r.post(
    '/api/auth/ldap/login',
    {
      config: { permission: 'public', rateLimit: rate },
      schema: { body: ldapLoginRequestSchema, response: { 200: loginResponseSchema } },
    },
    async (request, reply) => {
      const outcome = await ldapLogin(
        ctx,
        request.body.providerId,
        request.body.username,
        request.body.password,
      );
      if ('error' in outcome) {
        await ctx.audit.record({
          actorUserId: null,
          action: 'auth.sso_failed',
          meta: { reason: outcome.error, directory: true },
          ipHmac: request.ipHmac,
        });
        // Only after the directory accepted the password do the reasons differ; none of them
        // reveals anything the person did not just prove they know.
        if (outcome.error === 'denied' || outcome.error === 'failed')
          throw new AppError('invalid_credentials', 'User name or password is wrong');
        throw new AppError('forbidden', 'This account may not sign in');
      }
      const session = await startSession(ctx, request, reply, outcome.userId);
      await ctx.audit.record({
        actorUserId: outcome.userId,
        action: 'auth.login',
        meta: { directory: true },
        ipHmac: request.ipHmac,
      });
      return { status: 'ok' as const, session };
    },
  );

  r.get(
    '/api/auth/proxy/:id/login',
    {
      config: { permission: 'public', rateLimit: rate },
      schema: { params: idParamSchema },
    },
    async (request, reply) => conclude(request, reply, await proxyLogin(ctx, request.params.id, request)),
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
        return reply.redirect(await startLogin(ctx, reply, request.params.id));
      } catch (error) {
        if (!(error instanceof AppError)) ctx.log.warn({ err: error }, 'single sign-on could not start');
        return reply.redirect('/login?sso_error=failed');
      }
    },
  );

  r.get(
    '/api/auth/sso/:id/metadata',
    { config: { permission: 'public' }, schema: { params: idParamSchema } },
    async (request, reply) =>
      reply
        .type('application/samlmetadata+xml; charset=utf-8')
        .send(await providerMetadata(ctx, request.params.id)),
  );

  // The provider posts the assertion from its own site. This scope alone parses forms, and the
  // route skips the origin check: the login state bound to the browser takes its place.
  app.register((scope, _options, done) => {
    scope.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string', bodyLimit: 1_048_576 },
      (_request, body, parsed) => {
        try {
          parsed(null, Object.fromEntries(new URLSearchParams(body as string)));
        } catch (error) {
          parsed(error as Error);
        }
      },
    );
    scope.withTypeProvider<ZodTypeProvider>().post(
      '/api/auth/sso/saml/acs',
      {
        config: { permission: 'public', rateLimit: rate, crossSite: true },
        schema: {
          body: z.object({
            SAMLResponse: z.string().min(1).max(1_000_000),
            RelayState: z.string().max(200).optional(),
          }),
        },
      },
      async (request, reply) =>
        conclude(request, reply, await finishSaml(ctx, request.body, request.cookies[BINDER_COOKIE], reply)),
    );
    done();
  });

  r.get('/api/sso/policy', { config: admin, schema: { response: { 200: ssoPolicySchema } } }, async () =>
    getSsoPolicy(ctx),
  );

  r.put(
    '/api/sso/policy',
    { config: admin, schema: { body: ssoPolicySchema, response: { 200: okSchema } } },
    async (request) => {
      await saveSsoPolicy(ctx, requireAuth(request), request.body);
      return { ok: true as const };
    },
  );

  r.post(
    '/api/sso/providers/:id/sync',
    {
      config: admin,
      schema: { params: idParamSchema, response: { 200: directorySyncResultSchema } },
    },
    async (request) => {
      const auth = requireAuth(request);
      const result = await syncDirectory(ctx, await enabledProvider(ctx, request.params.id, 'ldap'));
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'sso.directory_synced',
        targetType: 'sso_provider',
        targetId: request.params.id,
        meta: { ...result },
      });
      return result;
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
