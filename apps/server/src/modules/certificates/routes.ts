// SPDX-License-Identifier: Apache-2.0
import {
  certificateSchema,
  certificateSerialSchema,
  certificateVerificationSchema,
  idParamSchema,
  libraryItemIdSchema,
} from '@coursecraft/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../auth/plugin.js';
import type { AppContext } from '../../http/context.js';
import { certificatePdf, issueCertificate, myCertificates, verifyCertificate } from './service.js';

export function certificateRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const config = { permission: 'learning.participate' as const };

  r.get(
    '/api/learn/certificates',
    { config, schema: { response: { 200: z.object({ items: z.array(certificateSchema) }) } } },
    async (request) => ({ items: await myCertificates(ctx, requireAuth(request)) }),
  );

  r.post(
    '/api/learn/items/:id/certificate',
    { config, schema: { params: libraryItemIdSchema, response: { 200: certificateSchema } } },
    async (request) => issueCertificate(ctx, requireAuth(request), request.params.id),
  );

  r.get(
    '/api/certificates/verify/:serial',
    {
      // Public, but throttled: serials are random, guessing them is pointless and slow.
      config: { permission: 'public', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ serial: certificateSerialSchema }),
        response: { 200: certificateVerificationSchema },
      },
    },
    async (request) => verifyCertificate(ctx, request.params.serial),
  );

  r.get(
    '/api/certificates/:id/pdf',
    { config, schema: { params: idParamSchema } },
    async (request, reply) => {
      const { pdf, serial } = await certificatePdf(ctx, requireAuth(request), request.params.id);
      return reply
        .type('application/pdf')
        .header('Content-Disposition', `attachment; filename="${serial}.pdf"`)
        .header('Cache-Control', 'no-store')
        .send(pdf);
    },
  );
}
