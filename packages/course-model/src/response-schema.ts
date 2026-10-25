// SPDX-License-Identifier: Apache-2.0
// Zod schema for a learner's answer, used to validate quiz submissions at the
// server boundary before server-side grading (SECURITY_AUDIT.md F-07). Kept
// out of scoring.ts so that file stays schema-library-free for the player
// bundle. The inferred type must stay assignable to `Response` in scoring.ts
// (checked at the bottom).
import { z } from 'zod';
import type { Response } from './scoring.js';

const id = z.string().max(200);
const text = z.string().max(4000);
const record = z.record(id, z.string().max(2000));

export const responseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('singleChoice'), choiceId: id.nullable() }).strict(),
  z.object({ type: z.literal('multipleChoice'), choiceIds: z.array(id).max(50) }).strict(),
  z.object({ type: z.literal('trueFalse'), value: z.boolean().nullable() }).strict(),
  z.object({ type: z.literal('shortAnswer'), text }).strict(),
  z.object({ type: z.literal('matching'), pairs: record }).strict(),
  z.object({ type: z.literal('sequence'), order: z.array(id).max(200) }).strict(),
  z.object({ type: z.literal('fillInBlanks'), blanks: record }).strict(),
  z.object({ type: z.literal('selectBlanks'), blanks: record }).strict(),
  z.object({ type: z.literal('dragDrop'), placements: z.record(id, id.nullable()) }).strict(),
  z.object({ type: z.literal('hotspot'), areaIds: z.array(id).max(200) }).strict(),
  z.object({ type: z.literal('likert'), answers: record }).strict(),
  z.object({ type: z.literal('numeric'), value: z.number().finite().nullable() }).strict(),
  z.object({ type: z.literal('wordBank'), blanks: record }).strict(),
  z.object({ type: z.literal('essay'), text }).strict(),
]);

export type ResponseInput = z.infer<typeof responseSchema>;

// Compile-time guard: the schema and the scoring type must not drift.
const _assignable: Response = {} as ResponseInput;
void _assignable;
