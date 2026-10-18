// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { uuidSchema } from './common.js';

export const groupNameSchema = z.string().trim().min(1).max(120);

export const groupSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  parentId: uuidSchema.nullable(),
  memberCount: z.number().int(),
});
export type Group = z.infer<typeof groupSchema>;

export const listGroupsResponseSchema = z.object({ items: z.array(groupSchema) });

export const createGroupRequestSchema = z
  .object({ name: groupNameSchema, parentId: uuidSchema.nullable().default(null) })
  .strict();

export const updateGroupRequestSchema = z
  .object({ name: groupNameSchema.optional(), parentId: uuidSchema.nullable().optional() })
  .strict();

export const groupMembersRequestSchema = z.object({ userIds: z.array(uuidSchema).min(1).max(1000) }).strict();

/** Trainers responsible for a group (they see its learners). */
export const groupManagersSchema = z.object({ userIds: z.array(uuidSchema).max(200) }).strict();

/** Whether trainers see only managed groups (default) or every learner. */
export const trainerScopeSchema = z.object({ mode: z.enum(['managed', 'all']) }).strict();
