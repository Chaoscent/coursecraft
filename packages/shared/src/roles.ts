// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

export const ROLES = ['admin', 'author', 'trainer', 'learner'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;
