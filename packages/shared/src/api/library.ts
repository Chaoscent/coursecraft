// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { uuidSchema } from './common.js';
import { myPathSchema } from './paths.js';

export const PACKAGE_KINDS = ['coursecraft', 'scorm12', 'scorm2004', 'xapi', 'cmi5'] as const;
export const packageKindSchema = z.enum(PACKAGE_KINDS);
export type PackageKind = z.infer<typeof packageKindSchema>;

export const libraryItemSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  description: z.string(),
  status: z.enum(['active', 'archived']),
  kind: packageKindSchema,
  sourceCourseId: z.uuid().nullable(),
  sourceVersion: z.number().int().nullable(),
  assignmentCount: z.number().int(),
  learnerCount: z.number().int(),
  completedCount: z.number().int(),
  updatedAt: z.string(),
});
export type LibraryItem = z.infer<typeof libraryItemSchema>;

export const libraryListResponseSchema = z.object({
  items: z.array(libraryItemSchema),
  /** Third-party packages need the content origin. */
  foreignPackagesEnabled: z.boolean(),
});

export const libraryQuerySchema = z.object({
  status: z.enum(['active', 'archived']).default('active'),
  q: z.string().trim().max(200).optional(),
});

export const updateLibraryItemSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .strict();

export const publishCourseSchema = z.object({ courseId: uuidSchema }).strict();
export const libraryItemIdSchema = z.object({ id: uuidSchema });

export const importPackageResponseSchema = z.object({
  id: uuidSchema,
  kind: packageKindSchema,
  title: z.string(),
  /** Only the first SCO/AU of a multi-unit package is launched. */
  multipleUnits: z.boolean(),
});

// --- assignments ------------------------------------------------------------

export const assignmentSchema = z.object({
  id: uuidSchema,
  targetType: z.enum(['user', 'group']),
  targetId: uuidSchema,
  targetName: z.string(),
  dueAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Assignment = z.infer<typeof assignmentSchema>;

export const assignmentsResponseSchema = z.object({ items: z.array(assignmentSchema) });

export const createAssignmentsSchema = z
  .object({
    userIds: z.array(uuidSchema).max(1000).default([]),
    groupIds: z.array(uuidSchema).max(200).default([]),
    dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
    /** Send an e-mail to every newly assigned learner (when mail is set up). */
    notify: z.boolean().default(false),
  })
  .strict()
  .refine((v) => v.userIds.length + v.groupIds.length > 0, { message: 'Nobody selected' });

export const assignmentParamsSchema = z.object({ id: uuidSchema, assignmentId: uuidSchema });

export const directoryQuerySchema = z.object({ q: z.string().trim().max(200).default('') });
export const directoryResponseSchema = z.object({
  items: z.array(z.object({ id: uuidSchema, displayName: z.string(), email: z.string() })),
});

// --- learner ------------------------------------------------------------------

export const LEARNING_STATUSES = ['not_started', 'in_progress', 'completed', 'passed', 'failed'] as const;
export const learningStatusSchema = z.enum(LEARNING_STATUSES);
export type LearningStatus = z.infer<typeof learningStatusSchema>;

export const myItemSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  description: z.string(),
  kind: packageKindSchema,
  dueAt: z.string().nullable(),
  overdue: z.boolean(),
  status: learningStatusSchema,
  scoreScaled: z.number().nullable(),
  attempt: z.number().int(),
  lastActivityAt: z.string().nullable(),
  /** First path that contains the course, if it is part of one. */
  path: myPathSchema.nullable(),
  /** Earlier steps of a sequential path are not done yet. */
  locked: z.boolean(),
});
export type MyItem = z.infer<typeof myItemSchema>;
export const myItemsResponseSchema = z.object({ items: z.array(myItemSchema) });

export const launchRequestSchema = z.object({ newAttempt: z.boolean().default(false) }).strict();

export const launchResponseSchema = z.object({
  launchId: uuidSchema,
  registrationId: uuidSchema,
  kind: packageKindSchema,
  /** URL for the iframe (content origin). */
  url: z.string(),
  /** Origin the host page exchanges messages with. */
  contentOrigin: z.string(),
  /** SCORM: stored runtime data to resume with. */
  cmi: z.record(z.string(), z.unknown()).nullable(),
  /** SCORM: what the wrapper needs to start the SCO. */
  scorm: z
    .object({
      launchPath: z.string(),
      mode: z.enum(['Normal', 'Review']),
      learnerId: z.string(),
      learnerName: z.string(),
    })
    .nullable(),
  title: z.string(),
});
export type LaunchResponse = z.infer<typeof launchResponseSchema>;

export const launchParamsSchema = z.object({ launchId: uuidSchema });

/** SCORM runtime data sent by the host page (from the wrapper). */
export const scormCommitSchema = z
  .object({
    cmi: z.record(z.string(), z.unknown()),
    finished: z.boolean().default(false),
  })
  .strict();

// --- reports and grading ----------------------------------------------------

export const reportRowSchema = z.object({
  userId: uuidSchema,
  displayName: z.string(),
  email: z.string(),
  status: learningStatusSchema,
  scoreScaled: z.number().nullable(),
  attempts: z.number().int(),
  timeSpentMs: z.number().int(),
  dueAt: z.string().nullable(),
  overdue: z.boolean(),
  completedAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
});
export type ReportRow = z.infer<typeof reportRowSchema>;

export const questionStatSchema = z.object({
  questionId: z.string(),
  description: z.string(),
  interactionType: z.string(),
  answers: z.number().int(),
  correct: z.number().int(),
  pendingGrading: z.number().int(),
});

export const itemReportSchema = z.object({
  item: z.object({ id: uuidSchema, title: z.string() }),
  rows: z.array(reportRowSchema),
  questions: z.array(questionStatSchema),
});

export const gradingItemSchema = z.object({
  registrationId: uuidSchema,
  questionId: z.string(),
  itemTitle: z.string(),
  learnerName: z.string(),
  description: z.string(),
  response: z.string(),
  scoreMax: z.number().nullable(),
  answeredAt: z.string(),
});
export const gradingQueueSchema = z.object({ items: z.array(gradingItemSchema) });

export const gradeRequestSchema = z
  .object({
    registrationId: uuidSchema,
    questionId: z.string().min(1).max(2000),
    score: z.number().min(0).max(1000),
  })
  .strict();
