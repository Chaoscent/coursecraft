// SPDX-License-Identifier: Apache-2.0
import {
  accountSessionsResponseSchema,
  changePasswordRequestSchema,
  idParamSchema,
  okSchema,
  sessionResponseSchema,
  totpConfirmRequestSchema,
  totpDisableRequestSchema,
  totpSetupResponseSchema,
  updateProfileRequestSchema,
} from '@lernwerk/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { generateSecret, generateURI } from 'otplib';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../../auth/passwords.js';
import { requireAuth, setSessionCookie, toAuthState } from '../../auth/plugin.js';
import type { AppContext } from '../../http/context.js';
import { AppError, notFound } from '../../http/errors.js';
import { checkTotp, openTotpSecret, totpAad } from '../auth/service.js';
import { sessionInfo } from '../auth/routes.js';
import { exportUserData } from '../users/privacy.js';

export function accountRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const SENSITIVE_RATE = { max: ctx.config.loginRateLimit, timeWindow: '1 minute' };

  /** Session state after a token rotation, for the response. */
  async function stateFor(token: string) {
    const resolved = await ctx.sessions.resolve(token);
    if (!resolved) throw new AppError('unauthenticated', 'Session ended');
    return toAuthState(ctx, resolved);
  }

  r.patch(
    '/api/account',
    {
      config: { permission: 'session.self' },
      schema: { body: updateProfileRequestSchema, response: { 200: sessionResponseSchema } },
    },
    async (request) => {
      const auth = requireAuth(request);
      const { displayName, locale } = request.body;
      await ctx.db
        .updateTable('users')
        .set({
          ...(displayName !== undefined ? { display_name: displayName } : {}),
          ...(locale !== undefined ? { locale } : {}),
          updated_at: new Date(),
        })
        .where('id', '=', auth.userId)
        .execute();
      const next = {
        ...auth,
        ...(displayName !== undefined ? { displayName } : {}),
        ...(locale !== undefined ? { locale } : {}),
      };
      return { session: sessionInfo(next) };
    },
  );

  r.post(
    '/api/account/password',
    {
      config: { permission: 'session.self', allowDuringPasswordChange: true, rateLimit: SENSITIVE_RATE },
      schema: { body: changePasswordRequestSchema, response: { 200: sessionResponseSchema } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const user = await ctx.db
        .selectFrom('users')
        .select('password_hash')
        .where('id', '=', auth.userId)
        .executeTakeFirstOrThrow();
      if (!(await verifyPassword(user.password_hash, request.body.currentPassword))) {
        throw new AppError('invalid_credentials', 'Current password is wrong');
      }
      await ctx.db
        .updateTable('users')
        .set({
          password_hash: await hashPassword(request.body.newPassword),
          must_change_password: false,
          updated_at: new Date(),
        })
        .where('id', '=', auth.userId)
        .execute();
      const ended = await ctx.sessions.revokeAll(auth.userId, auth.sessionId);
      const token = await ctx.sessions.rotate(auth.sessionId);
      setSessionCookie(reply, ctx, token);
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'account.password_changed',
        meta: { otherSessionsEnded: ended },
        ipHmac: request.ipHmac,
      });
      request.auth = await stateFor(token);
      return { session: sessionInfo(request.auth) };
    },
  );

  r.get(
    '/api/account/sessions',
    { config: { permission: 'session.self' }, schema: { response: { 200: accountSessionsResponseSchema } } },
    async (request) => {
      const auth = requireAuth(request);
      const rows = await ctx.db
        .selectFrom('sessions')
        .select(['id', 'created_at', 'last_seen_at', 'user_agent'])
        .where('user_id', '=', auth.userId)
        .orderBy('last_seen_at', 'desc')
        .execute();
      return {
        items: rows.map((s) => ({
          id: s.id,
          createdAt: s.created_at.toISOString(),
          lastSeenAt: s.last_seen_at.toISOString(),
          userAgent: s.user_agent,
          current: s.id === auth.sessionId,
        })),
      };
    },
  );

  r.delete(
    '/api/account/sessions/:id',
    {
      config: { permission: 'session.self' },
      schema: { params: idParamSchema, response: { 200: okSchema } },
    },
    async (request) => {
      const auth = requireAuth(request);
      // Scoped to the caller's own sessions: other users' ids are simply not found.
      const result = await ctx.db
        .deleteFrom('sessions')
        .where('id', '=', request.params.id)
        .where('user_id', '=', auth.userId)
        .executeTakeFirst();
      if (!Number(result.numDeletedRows)) throw notFound();
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'account.session_ended',
        targetType: 'session',
        targetId: request.params.id,
        ipHmac: request.ipHmac,
      });
      return { ok: true as const };
    },
  );

  r.post(
    '/api/account/sessions/end-others',
    {
      config: { permission: 'session.self' },
      schema: { response: { 200: z.object({ ended: z.number().int() }) } },
    },
    async (request) => {
      const auth = requireAuth(request);
      const ended = await ctx.sessions.revokeAll(auth.userId, auth.sessionId);
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'account.sessions_ended',
        meta: { ended },
        ipHmac: request.ipHmac,
      });
      return { ended };
    },
  );

  r.post(
    '/api/account/totp/setup',
    {
      config: { permission: 'session.self', rateLimit: SENSITIVE_RATE },
      schema: { response: { 200: totpSetupResponseSchema } },
    },
    async (request) => {
      const auth = requireAuth(request);
      if (auth.totpEnabled) throw new AppError('conflict', 'Two-factor authentication is already active');
      const secret = generateSecret();
      const sealed = ctx.box.seal(secret, totpAad(auth.userId));
      // Pending until confirmed: totp_last_step stays null.
      await ctx.db
        .updateTable('users')
        .set({ totp_secret: JSON.stringify(sealed), totp_last_step: null })
        .where('id', '=', auth.userId)
        .execute();
      return { secret, uri: generateURI({ issuer: 'Lernwerk', label: auth.email, secret }) };
    },
  );

  r.post(
    '/api/account/totp/confirm',
    {
      config: { permission: 'session.self', rateLimit: SENSITIVE_RATE },
      schema: { body: totpConfirmRequestSchema, response: { 200: sessionResponseSchema } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const user = await ctx.db
        .selectFrom('users')
        .select(['totp_secret', 'totp_last_step'])
        .where('id', '=', auth.userId)
        .executeTakeFirstOrThrow();
      if (!user.totp_secret || user.totp_last_step !== null)
        throw new AppError('conflict', 'No pending setup');
      const step = checkTotp(openTotpSecret(ctx, auth.userId, user.totp_secret), request.body.code, null);
      if (step === null) throw new AppError('invalid_credentials', 'Code is wrong');
      await ctx.db.updateTable('users').set({ totp_last_step: step }).where('id', '=', auth.userId).execute();
      // Stronger authentication: new token for this session, others end.
      await ctx.sessions.revokeAll(auth.userId, auth.sessionId);
      const token = await ctx.sessions.rotate(auth.sessionId);
      setSessionCookie(reply, ctx, token);
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'account.totp_enabled',
        ipHmac: request.ipHmac,
      });
      return { session: sessionInfo(await stateFor(token)) };
    },
  );

  r.post(
    '/api/account/totp/disable',
    {
      config: { permission: 'session.self', rateLimit: SENSITIVE_RATE },
      schema: { body: totpDisableRequestSchema, response: { 200: sessionResponseSchema } },
    },
    async (request) => {
      const auth = requireAuth(request);
      const user = await ctx.db
        .selectFrom('users')
        .select('password_hash')
        .where('id', '=', auth.userId)
        .executeTakeFirstOrThrow();
      if (!(await verifyPassword(user.password_hash, request.body.password))) {
        throw new AppError('invalid_credentials', 'Password is wrong');
      }
      await ctx.db
        .updateTable('users')
        .set({ totp_secret: null, totp_last_step: null })
        .where('id', '=', auth.userId)
        .execute();
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'account.totp_disabled',
        ipHmac: request.ipHmac,
      });
      return { session: sessionInfo({ ...auth, totpEnabled: false }) };
    },
  );

  r.get(
    '/api/account/export',
    {
      config: { permission: 'session.self' },
      schema: { response: { 200: z.record(z.string(), z.unknown()) } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'privacy.export',
        targetType: 'user',
        targetId: auth.userId,
        ipHmac: request.ipHmac,
      });
      void reply.header('Content-Disposition', 'attachment; filename="lernwerk-personal-data.json"');
      return exportUserData(ctx, auth.userId);
    },
  );
}
