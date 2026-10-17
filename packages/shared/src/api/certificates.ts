// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { uuidSchema } from './common.js';

export const certificateSchema = z.object({
  id: uuidSchema,
  serial: z.string(),
  itemTitle: z.string(),
  completedAt: z.string(),
  issuedAt: z.string(),
});
export type Certificate = z.infer<typeof certificateSchema>;
