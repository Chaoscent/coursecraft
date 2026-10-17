// SPDX-License-Identifier: Apache-2.0
import { okSchema, passwordResetConfirmSchema, passwordResetRequestSchema } from '@coursecraft/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppContext } from '../../http/context.js';
import { confirmReset, requestReset } from './service.js';

export function passwordResetRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const rate = { max: ctx.config.loginRateLimit, timeWindow: '1 minute' };

  r.post(
    '/api/auth/password-reset',
    {
      config: { permission: 'public', rateLimit: rate },
      schema: { body: passwordResetRequestSchema, response: { 200: okSchema } },
    },
    (request) => {
      // Not awaited: the response must not reveal whether the account exists.
      requestReset(ctx, request.body.email, request.ipHmac).catch((error: unknown) =>
        ctx.log.error({ err: error }, 'password reset request failed'),
      );
      return Promise.resolve({ ok: true as const });
    },
  );

  r.post(
    '/api/auth/password-reset/confirm',
    {
      config: { permission: 'public', rateLimit: rate },
      schema: { body: passwordResetConfirmSchema, response: { 200: okSchema } },
    },
    async (request) => {
      await confirmReset(ctx, request.body.token, request.body.newPassword, request.ipHmac);
      return { ok: true as const };
    },
  );
}
