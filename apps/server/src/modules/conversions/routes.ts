// SPDX-License-Identifier: Apache-2.0
import {
  conversionResponseSchema,
  idParamSchema,
  mediaUploadQuerySchema,
  okSchema,
  startConversionResponseSchema,
} from '@lernwerk/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../auth/plugin.js';
import type { AppContext } from '../../http/context.js';
import { AppError, badRequest } from '../../http/errors.js';
import { assertCourseEditor } from '../../policy/courses.js';
import { displayName } from '../assets/service.js';
import { getConversion, skipRendering, startMediaConversion, startPresentationImport } from './service.js';

const importQuerySchema = z.object({
  language: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/)
    .optional(),
});

async function upload(request: FastifyRequest): Promise<{ bytes: Buffer; name: string }> {
  const file = await request.file();
  if (!file) throw badRequest('No file');
  try {
    return { bytes: await file.toBuffer(), name: displayName(file.filename) };
  } catch {
    throw new AppError('payload_too_large', 'File is too large');
  }
}

export function conversionRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const config = { permission: 'courses.author' as const };

  r.post(
    '/api/courses/import',
    {
      config: { ...config, allowMultipart: true },
      schema: { querystring: importQuerySchema, response: { 200: startConversionResponseSchema } },
    },
    async (request) => {
      const auth = requireAuth(request);
      const { bytes, name } = await upload(request);
      const conversionId = await startPresentationImport(
        ctx,
        auth,
        bytes,
        name,
        request.query.language ?? auth.locale,
      );
      return { conversionId };
    },
  );

  r.post(
    '/api/courses/:id/media',
    {
      config: { ...config, allowMultipart: true },
      schema: {
        params: idParamSchema,
        querystring: mediaUploadQuerySchema,
        response: { 200: startConversionResponseSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      await assertCourseEditor(ctx.db, auth, request.params.id);
      const { bytes, name } = await upload(request);
      const conversionId = await startMediaConversion(
        ctx,
        auth,
        request.params.id,
        bytes,
        name,
        request.query,
      );
      return { conversionId };
    },
  );

  r.get(
    '/api/conversions/:id',
    { config, schema: { params: idParamSchema, response: { 200: conversionResponseSchema } } },
    async (request) => getConversion(ctx, requireAuth(request), request.params.id),
  );

  r.post(
    '/api/conversions/:id/skip',
    { config, schema: { params: idParamSchema, response: { 200: okSchema } } },
    async (request) => {
      await skipRendering(ctx, requireAuth(request), request.params.id);
      return { ok: true as const };
    },
  );
}
