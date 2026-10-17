// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { uuidSchema } from './common.js';

export const CONVERSION_KINDS = ['pptx-import', 'media'] as const;
export const CONVERSION_STATUSES = ['pending', 'done', 'failed'] as const;

/** Notes collected while importing; shown to the author after the import. */
export const IMPORT_WARNINGS = [
  'unsupported_content',
  'unsupported_image',
  'media_skipped',
  'render_failed',
  'render_skipped',
  'too_many_elements',
] as const;

export const importWarningSchema = z.object({
  code: z.enum(IMPORT_WARNINGS),
  /** 1-based slide number, if the warning concerns one slide. */
  slide: z.number().int().min(1).optional(),
});
export type ImportWarning = z.infer<typeof importWarningSchema>;

export const conversionResponseSchema = z.object({
  id: uuidSchema,
  kind: z.enum(CONVERSION_KINDS),
  status: z.enum(CONVERSION_STATUSES),
  error: z.string().nullable(),
  createdAt: z.string(),
  /** pptx-import: the created course. */
  courseId: z.uuid().nullable(),
  warnings: z.array(importWarningSchema),
  /** media: the converted file, attached to the course. */
  asset: z
    .object({
      sha256: z.string(),
      mime: z.string(),
      size: z.number().int(),
      name: z.string(),
      durationMs: z.number().int().nullable(),
    })
    .nullable(),
});
export type ConversionResponse = z.infer<typeof conversionResponseSchema>;

export const startConversionResponseSchema = z.object({ conversionId: uuidSchema });

export const mediaUploadQuerySchema = z.object({
  target: z.enum(['audio', 'video']).default('audio'),
  normalize: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});
