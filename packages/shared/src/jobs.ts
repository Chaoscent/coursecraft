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
  /** App → app: one e-mail to one user, rendered at send time. */
  mail: 'mail.send',
  /** App → app: build an export archive in the background. */
  exportBuild: 'export.build',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const PGBOSS_SCHEMA = 'pgboss';

/**
 * Job payloads carry only the job directory name (a UUID inside the work
 * volume) and parameters, never personal data or paths chosen by users.
 */
const jobIdSchema = z.uuid();

/** The organisation a job belongs to; absent for the default tenant (and for jobs queued before tenants existed). */
const tenantField = { tenantId: z.uuid().optional() };

export const pptxRenderJobSchema = z
  .object({ jobId: jobIdSchema, widthPx: z.number().int().min(320).max(3840), ...tenantField })
  .strict();
export type PptxRenderJob = z.infer<typeof pptxRenderJobSchema>;

export const mediaTargetSchema = z.enum(['audio', 'video']);
export const mediaJobSchema = z
  .object({
    jobId: jobIdSchema,
    ...tenantField,
    target: mediaTargetSchema,
    /** Loudness normalisation (EBU R128) for narration. */
    normalize: z.boolean(),
    /** Keeps only this part of the input (screen recordings, uploads). */
    trim: z
      .object({
        startMs: z.number().int().min(0),
        endMs: z.number().int().min(1).optional(),
      })
      .strict()
      .refine((t) => t.endMs === undefined || t.endMs > t.startMs, 'endMs must be after startMs')
      .optional(),
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
    ...tenantField,
    queue: z.enum([QUEUES.pptxRender, QUEUES.media]),
    ok: z.boolean(),
    error: z.enum(CONVERT_ERRORS).optional(),
    /** Output file names (validated again by the app). */
    outputs: z.array(z.string().max(100)).max(1000),
    durationMs: z.number().int().min(0).optional(),
  })
  .strict();
export type ConvertDoneJob = z.infer<typeof convertDoneJobSchema>;

export const MAIL_KINDS = ['passwordReset', 'assigned', 'reminder'] as const;
export const mailJobSchema = z
  .object({
    ...tenantField,
    kind: z.enum(MAIL_KINDS),
    userId: jobIdSchema,
    /** Template parameters; secrets (reset tokens) only sealed by the app. */
    params: z.record(z.string().max(50), z.string().max(4000)),
  })
  .strict();
export type MailJob = z.infer<typeof mailJobSchema>;

export const exportJobSchema = z.object({ exportId: jobIdSchema, ...tenantField }).strict();
export type ExportJob = z.infer<typeof exportJobSchema>;
