// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { uuidSchema } from './common.js';

export const pathInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).default(''),
    sequential: z.boolean().default(true),
    status: z.enum(['active', 'archived']).default('active'),
    /** Library items in learning order. */
    itemIds: z.array(uuidSchema).min(1).max(100),
  })
  .strict()
  .refine((p) => new Set(p.itemIds).size === p.itemIds.length, { message: 'Duplicate item' });
export type PathInput = z.infer<typeof pathInputSchema>;

export const pathSummarySchema = z.object({
  id: uuidSchema,
  title: z.string(),
  description: z.string(),
  sequential: z.boolean(),
  status: z.enum(['active', 'archived']),
  stepCount: z.number().int(),
  assignmentCount: z.number().int(),
  updatedAt: z.string(),
});
export type PathSummary = z.infer<typeof pathSummarySchema>;
export const pathsResponseSchema = z.object({ items: z.array(pathSummarySchema) });

export const pathDetailSchema = pathSummarySchema.extend({
  steps: z.array(z.object({ itemId: uuidSchema, title: z.string() })),
});
export type PathDetail = z.infer<typeof pathDetailSchema>;

export const pathAssignmentParamsSchema = z.object({ id: uuidSchema, assignmentId: uuidSchema });

/** Where a learner's course sits in a path. */
export const myPathSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  step: z.number().int(),
  steps: z.number().int(),
  sequential: z.boolean(),
});
export type MyPath = z.infer<typeof myPathSchema>;
