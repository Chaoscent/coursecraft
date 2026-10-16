// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { assetRefSchema, idSchema, langSchema, localizedTextSchema } from '../primitives.js';
import { localizedRichTextSchema } from '../rich-text.js';

const moodSchema = z.enum(['neutral', 'positive', 'negative', 'thinking']);

const characterSchema = z
  .object({
    id: idSchema,
    name: localizedTextSchema,
    /** One image per mood; `neutral` is required. */
    images: z.object({ neutral: assetRefSchema }).catchall(assetRefSchema),
    altText: localizedTextSchema,
  })
  .strict();

const nextSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('scene'), sceneId: idSchema }).strict(),
  z.object({ type: z.literal('end') }).strict(),
]);

const sceneSchema = z
  .object({
    id: idSchema,
    characterId: idSchema,
    mood: moodSchema.default('neutral'),
    speech: localizedTextSchema,
    audio: z.record(langSchema, assetRefSchema).optional(),
    background: assetRefSchema.optional(),
    /** Editor-only graph position. */
    position: z.object({ x: z.number(), y: z.number() }).strict(),
    responses: z
      .array(
        z
          .object({
            id: idSchema,
            text: localizedTextSchema,
            feedback: localizedRichTextSchema.optional(),
            points: z.number().min(-1000).max(1000).default(0),
            next: nextSchema,
          })
          .strict(),
      )
      .max(6),
  })
  .strict();

export const dialogNodeSchema = z
  .object({
    kind: z.literal('dialog'),
    id: idSchema,
    title: localizedTextSchema,
    characters: z.array(characterSchema).min(1).max(10),
    scenes: z.array(sceneSchema).min(1).max(500),
    startSceneId: idSchema,
    /** Picked by score at the end; the highest matching `minScore` wins. */
    outcomes: z
      .array(
        z
          .object({
            id: idSchema,
            title: localizedTextSchema,
            body: localizedRichTextSchema,
            minScore: z.number(),
            passed: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict()
  .superRefine((dialog, ctx) => {
    const sceneIds = new Set(dialog.scenes.map((s) => s.id));
    const characterIds = new Set(dialog.characters.map((c) => c.id));
    if (!sceneIds.has(dialog.startSceneId)) {
      ctx.addIssue({ code: 'custom', message: 'Unknown start scene', path: ['startSceneId'] });
    }
    dialog.scenes.forEach((scene, si) => {
      if (!characterIds.has(scene.characterId)) {
        ctx.addIssue({ code: 'custom', message: 'Unknown character', path: ['scenes', si, 'characterId'] });
      }
      scene.responses.forEach((response, ri) => {
        if (response.next.type === 'scene' && !sceneIds.has(response.next.sceneId)) {
          ctx.addIssue({
            code: 'custom',
            message: 'Unknown scene',
            path: ['scenes', si, 'responses', ri, 'next'],
          });
        }
      });
    });
  });
export type DialogNode = z.infer<typeof dialogNodeSchema>;
