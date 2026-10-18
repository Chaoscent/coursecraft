// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { isoDateSchema, uuidSchema } from './common.js';

/** Course documents are validated against @coursecraft/course-model on both sides. */
const documentPart = z.record(z.string(), z.unknown());

export const COURSE_SORT_KEYS = ['title', 'updated'] as const;

export const courseSummarySchema = z.object({
  id: uuidSchema,
  title: z.string(),
  status: z.enum(['draft', 'archived']),
  ownerId: uuidSchema,
  ownerName: z.string(),
  updatedAt: isoDateSchema,
  nodeCount: z.number().int(),
  lockedBy: z.string().nullable(),
});
export type CourseSummary = z.infer<typeof courseSummarySchema>;

export const listCoursesQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(['draft', 'archived']).default('draft'),
  sort: z.enum(COURSE_SORT_KEYS).default('updated'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export const listCoursesResponseSchema = z.object({ items: z.array(courseSummarySchema) });

export const createCourseRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    language: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/),
  })
  .strict();

export const lockInfoSchema = z.object({
  userId: uuidSchema,
  userName: z.string(),
  mine: z.boolean(),
  heartbeatAt: isoDateSchema,
});
export type LockInfo = z.infer<typeof lockInfoSchema>;

export const courseDocumentResponseSchema = z.object({
  course: documentPart,
  rev: z.number().int(),
  nodeRevs: z.record(z.string(), z.number().int()),
  lock: lockInfoSchema.nullable(),
  canManage: z.boolean(),
});

export const updateCourseRequestSchema = z
  .object({
    rev: z.number().int(),
    title: z.string().trim().min(1).max(200).optional(),
    meta: documentPart.optional(),
    languages: documentPart.optional(),
    settings: documentPart.optional(),
    structure: documentPart.optional(),
  })
  .strict();

export const revResponseSchema = z.object({ rev: z.number().int() });

export const addNodeRequestSchema = z
  .object({
    rev: z.number().int(),
    chapterId: z.string().min(1).max(64),
    index: z.number().int().min(0),
    node: documentPart,
  })
  .strict();

export const nodeRevResponseSchema = z.object({ rev: z.number().int(), nodeRev: z.number().int() });

export const updateNodeRequestSchema = z.object({ rev: z.number().int(), doc: documentPart }).strict();

export const nodeParamsSchema = z.object({
  id: uuidSchema,
  nodeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
});

export const assetSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mime: z.string(),
  size: z.number().int(),
  name: z.string(),
});
export type Asset = z.infer<typeof assetSchema>;

export const assetParamsSchema = z.object({ id: uuidSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/) });

export const lockResponseSchema = z.object({ acquired: z.boolean(), lock: lockInfoSchema.nullable() });

export const versionSchema = z.object({
  id: uuidSchema,
  number: z.number().int(),
  note: z.string(),
  createdAt: isoDateSchema,
  createdByName: z.string().nullable(),
});
export const listVersionsResponseSchema = z.object({ items: z.array(versionSchema) });
export const createVersionRequestSchema = z.object({ note: z.string().trim().max(500).default('') }).strict();
export const versionParamsSchema = z.object({ id: uuidSchema, versionId: uuidSchema });

export const EXPORT_FORMATS = ['html5', 'scorm12', 'scorm2004-3', 'scorm2004-4', 'xapi', 'cmi5'] as const;
export const exportQuerySchema = z.object({ format: z.enum(EXPORT_FORMATS) });

export const courseMembersResponseSchema = z.object({
  items: z.array(z.object({ userId: uuidSchema, displayName: z.string(), email: z.string() })),
});
export const setCourseMembersRequestSchema = z.object({ userIds: z.array(uuidSchema).max(100) }).strict();

/**
 * One editor save: everything that changed since the last acknowledged
 * state, applied atomically. `rev` is the course revision the client has.
 */
export const saveCourseRequestSchema = z
  .object({
    rev: z.number().int(),
    title: z.string().trim().min(1).max(200).optional(),
    meta: documentPart.optional(),
    languages: documentPart.optional(),
    settings: documentPart.optional(),
    structure: documentPart.optional(),
    upsertNodes: z.array(documentPart).max(500).default([]),
    deleteNodes: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/))
      .max(500)
      .default([]),
  })
  .strict();

export const saveCourseResponseSchema = z.object({
  rev: z.number().int(),
  nodeRevs: z.record(z.string(), z.number().int()),
});

/** Export built in the background; downloadable for a day. */
export const startExportRequestSchema = z.object({ format: z.enum(EXPORT_FORMATS) }).strict();
export const exportStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(['pending', 'done', 'failed']),
  error: z.string().nullable(),
  fileName: z.string().nullable(),
  size: z.number().nullable(),
  createdAt: z.string(),
});
export type ExportStatus = z.infer<typeof exportStatusSchema>;
