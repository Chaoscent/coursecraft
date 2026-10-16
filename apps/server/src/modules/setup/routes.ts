// SPDX-License-Identifier: Apache-2.0
import { loginResponseSchema, setupRequestSchema, setupStatusResponseSchema } from '@lernwerk/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { hashPassword } from '../../auth/passwords.js';
import type { AppContext } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { startSession } from '../auth/routes.js';
import { consumeSetupToken, isSetupRequired } from './service.js';

export function setupRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/api/setup',
    { config: { permission: 'public' }, schema: { response: { 200: setupStatusResponseSchema } } },
    async () => ({ required: await isSetupRequired(ctx) }),
  );

  r.post(
    '/api/setup',
    {
      config: { permission: 'public', rateLimit: { max: ctx.config.loginRateLimit, timeWindow: '1 minute' } },
      schema: { body: setupRequestSchema, response: { 200: loginResponseSchema } },
    },
    async (request, reply) => {
      const { token, email, displayName, password, locale } = request.body;
      const passwordHash = await hashPassword(password);
      const userId = await ctx.db.transaction().execute(async (tx) => {
        if (!(await consumeSetupToken(tx, token))) return null;
        const user = await tx
          .insertInto('users')
          .values({ email, display_name: displayName, password_hash: passwordHash, locale })
          .returning('id')
          .executeTakeFirstOrThrow();
        await tx.insertInto('user_roles').values({ user_id: user.id, role: 'admin' }).execute();
        await ctx.audit.record(
          {
            actorUserId: user.id,
            action: 'setup.completed',
            targetType: 'user',
            targetId: user.id,
            ipHmac: request.ipHmac,
          },
          tx,
        );
        return user.id;
      });
      if (!userId) {
        await ctx.audit.record({ actorUserId: null, action: 'setup.rejected', ipHmac: request.ipHmac });
        throw new AppError('forbidden', 'Setup token is invalid or expired, or setup is already complete');
      }
      const session = await startSession(ctx, request, reply, userId);
      return { status: 'ok' as const, session };
    },
  );
}
