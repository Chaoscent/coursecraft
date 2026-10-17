// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

/**
 * Queue names. The migrate step creates every queue, because the app and
 * converter database roles have no DDL rights.
 */
export const QUEUES = {
  pptxRender: 'convert.pptx-render',
  media: 'convert.media',
  /** Converter → app: a conversion finished (or failed). */
  convertDone: 'convert.done',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const PGBOSS_SCHEMA = 'pgboss';

/**
 * Job payloads carry only the job directory name (a UUID inside the work
 * volume) and parameters, never personal data or paths chosen by users.
 */
const jobIdSchema = z.uuid();

export const pptxRenderJobSchema = z
  .object({ jobId: jobIdSchema, widthPx: z.number().int().min(320).max(3840) })
  .strict();
export type PptxRenderJob = z.infer<typeof pptxRenderJobSchema>;

export const mediaTargetSchema = z.enum(['audio', 'video']);
export const mediaJobSchema = z
  .object({
    jobId: jobIdSchema,
    target: mediaTargetSchema,
    /** Loudness normalisation (EBU R128) for narration. */
    normalize: z.boolean(),
  })
  .strict();
export type MediaJob = z.infer<typeof mediaJobSchema>;

/** Output files written by the converter into `<work>/<jobId>/out/`. */
export const CONVERTER_OUTPUT = {
  pdfPage: /^page-\d{4}\.png$/,
  audio: 'audio.m4a',
  videoMp4: 'video.mp4',
  videoWebm: 'video.webm',
  poster: 'poster.png',
} as const;

export const CONVERT_ERRORS = ['unsupported', 'timeout', 'too_large', 'failed'] as const;

export const convertDoneJobSchema = z
  .object({
    jobId: jobIdSchema,
    queue: z.enum([QUEUES.pptxRender, QUEUES.media]),
    ok: z.boolean(),
    error: z.enum(CONVERT_ERRORS).optional(),
    /** Output file names (validated again by the app). */
    outputs: z.array(z.string().max(100)).max(1000),
    durationMs: z.number().int().min(0).optional(),
  })
  .strict();
export type ConvertDoneJob = z.infer<typeof convertDoneJobSchema>;
