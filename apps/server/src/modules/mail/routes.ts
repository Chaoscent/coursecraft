// SPDX-License-Identifier: Apache-2.0
import { okSchema, smtpSettingsInputSchema, smtpSettingsSchema } from '@coursecraft/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireAuth } from '../../auth/plugin.js';
import type { AppContext } from '../../http/context.js';
import { getSmtpSettings, saveSmtpSettings, sendTestMail } from './service.js';

export function mailRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const config = { permission: 'settings.manage' as const };

  r.get('/api/settings/smtp', { config, schema: { response: { 200: smtpSettingsSchema } } }, async () =>
    getSmtpSettings(ctx),
  );

  r.put(
    '/api/settings/smtp',
    { config, schema: { body: smtpSettingsInputSchema, response: { 200: smtpSettingsSchema } } },
    async (request) => {
      await saveSmtpSettings(ctx, requireAuth(request), request.body);
      return getSmtpSettings(ctx);
    },
  );

  r.post(
    '/api/settings/smtp/test',
    {
      config: { ...config, rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: { response: { 200: okSchema } },
    },
    async (request) => {
      await sendTestMail(ctx, requireAuth(request));
      return { ok: true as const };
    },
  );
}
