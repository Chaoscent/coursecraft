// SPDX-License-Identifier: Apache-2.0
import { singleLogoutUrl } from '../sso/service.js';
import type { SealedJson } from '../../db/schema.js';
import {
  getSessionResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  logoutResponseSchema,
  totpLoginRequestSchema,
  type SessionInfo,
} from '@coursecraft/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { clearSessionCookie, requireAuth, setSessionCookie, toAuthState } from '../../auth/plugin.js';
import type { AppContext, AuthState } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { isSetupRequired } from '../setup/service.js';
import { passwordLogin, totpLogin } from './service.js';

export function sessionInfo(auth: AuthState): SessionInfo {
  return {
    csrfToken: auth.csrfToken,
    user: {
      id: auth.userId,
      email: auth.email,
      displayName: auth.displayName,
      locale: auth.locale,
      roles: auth.roles,
      permissions: auth.permissions,
      mustChangePassword: auth.mustChangePassword,
      totpEnabled: auth.totpEnabled,
    },
  };
}

/**
 * Creates a fresh session after successful authentication. Any session the
 * client presented before is deleted, so a planted token never becomes
 * authenticated (session fixation).
 */
export async function startSession(
  ctx: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  sso?: { providerId: string; logout: SealedJson | null },
): Promise<SessionInfo> {
  if (request.auth) await ctx.sessions.revoke(request.auth.sessionId);
  const { token } = await ctx.sessions.create(
    userId,
    { ipHmac: request.ipHmac, userAgent: request.headers['user-agent'] ?? null },
    sso,
  );
  await ctx.db.updateTable('users').set({ last_login_at: new Date() }).where('id', '=', userId).execute();
  const resolved = await ctx.sessions.resolve(token);
  if (!resolved) throw new AppError('internal', 'Session could not be created');
  setSessionCookie(reply, ctx, token);
  request.auth = toAuthState(ctx, resolved);
  return sessionInfo(request.auth);
}

export function authRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const LOGIN_RATE = { max: ctx.config.loginRateLimit, timeWindow: '1 minute' };

  r.get(
    '/api/session',
    {
      config: { permission: 'public' },
      schema: { response: { 200: getSessionResponseSchema } },
    },
    async (request) => ({
      session: request.auth ? sessionInfo(request.auth) : null,
      setupRequired: await isSetupRequired(ctx),
    }),
  );

  r.post(
    '/api/auth/login',
    {
      config: { permission: 'public', rateLimit: LOGIN_RATE },
      schema: { body: loginRequestSchema, response: { 200: loginResponseSchema } },
    },
    async (request, reply) => {
      const outcome = await passwordLogin(ctx, request.body.email, request.body.password);
      if (outcome.kind === 'failed') {
        await ctx.audit.record({
          actorUserId: outcome.userId,
          action: 'auth.login_failed',
          meta: { reason: outcome.reason },
          ipHmac: request.ipHmac,
        });
        throw new AppError('invalid_credentials', 'E-mail or password is wrong');
      }
      if (outcome.kind === 'totp') return { status: 'totp_required' as const, challenge: outcome.challenge };
      const session = await startSession(ctx, request, reply, outcome.userId);
      await ctx.audit.record({ actorUserId: outcome.userId, action: 'auth.login', ipHmac: request.ipHmac });
      return { status: 'ok' as const, session };
    },
  );

  r.post(
    '/api/auth/login/totp',
    {
      config: { permission: 'public', rateLimit: LOGIN_RATE },
      schema: { body: totpLoginRequestSchema, response: { 200: loginResponseSchema } },
    },
    async (request, reply) => {
      const result = await totpLogin(ctx, request.body.challenge, request.body.code);
      if ('failedUserId' in result) {
        await ctx.audit.record({
          actorUserId: result.failedUserId,
          action: 'auth.login_failed',
          meta: { reason: 'totp' },
          ipHmac: request.ipHmac,
        });
        throw new AppError('invalid_credentials', 'Code is wrong or expired');
      }
      const session = await startSession(ctx, request, reply, result.userId);
      await ctx.audit.record({
        actorUserId: result.userId,
        action: 'auth.login',
        meta: { totp: true },
        ipHmac: request.ipHmac,
      });
      return { status: 'ok' as const, session };
    },
  );

  r.post(
    '/api/auth/logout',
    {
      config: { permission: 'session.self', allowDuringPasswordChange: true },
      schema: { response: { 200: logoutResponseSchema } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const sso = await ctx.sessions.ssoOf(auth.sessionId);
      await ctx.sessions.revoke(auth.sessionId);
      clearSessionCookie(reply);
      await ctx.audit.record({ actorUserId: auth.userId, action: 'auth.logout', ipHmac: request.ipHmac });
      // Single logout: the browser continues at the provider that signed the person in.
      const redirect = sso ? await singleLogoutUrl(ctx, auth.userId, sso) : null;
      return { ok: true as const, redirect };
    },
  );
}
