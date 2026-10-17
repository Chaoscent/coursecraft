// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { dialogNodeSchema } from './nodes/dialog.js';
import { interactionNodeSchema } from './nodes/interaction.js';
import { quizNodeSchema, surveyNodeSchema } from './nodes/quiz.js';
import { slideNodeSchema } from './nodes/slide.js';
import {
  assetRefSchema,
  colorSchema,
  idSchema,
  langSchema,
  localizedTextSchema,
  sha256Schema,
} from './primitives.js';

export const COURSE_FORMAT = 'lernwerk.course';
export const CURRENT_FORMAT_VERSION = 1;

export const nodeSchema = z.union([
  slideNodeSchema,
  quizNodeSchema,
  surveyNodeSchema,
  interactionNodeSchema,
  dialogNodeSchema,
]);
export type CourseNode = z.infer<typeof nodeSchema>;

const assetEntrySchema = z
  .object({
    mime: z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/),
    size: z.number().int().min(0),
    /** Original file name, for display only. */
    name: z.string().max(255),
  })
  .strict();

export const courseSettingsSchema = z
  .object({
    canvas: z
      .object({ width: z.number().int().min(320).max(3840), height: z.number().int().min(240).max(2160) })
      .strict()
      .default({ width: 1280, height: 720 }),
    navigation: z.enum(['free', 'linear']).default('free'),
    completion: z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('viewedPercent'), percent: z.number().min(1).max(100) }).strict(),
        z.object({ type: z.literal('quizPassed'), quizId: idSchema }).strict(),
      ])
      .default({ type: 'viewedPercent', percent: 100 }),
    player: z
      .object({
        sidebar: z.enum(['left', 'right', 'none']).default('left'),
        showProgress: z.boolean().default(true),
        showNotes: z.boolean().default(false),
        allowSkipMedia: z.boolean().default(true),
      })
      .strict()
      .default({ sidebar: 'left', showProgress: true, showNotes: false, allowSkipMedia: true }),
    branding: z
      .object({
        logo: assetRefSchema.optional(),
        accent: colorSchema.default('#1f5fa6'),
        text: colorSchema.default('#1d1f22'),
        background: colorSchema.default('#ffffff'),
      })
      .strict()
      .default({ accent: '#1f5fa6', text: '#1d1f22', background: '#ffffff' }),
  })
  .strict();

export const courseMetaSchema = z
  .object({
    title: localizedTextSchema,
    description: localizedTextSchema.optional(),
    authors: z.array(z.string().max(200)).max(50).default([]),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const courseLanguagesSchema = z
  .object({ default: langSchema, available: z.array(langSchema).min(1).max(50) })
  .strict()
  .refine((l) => l.available.includes(l.default), { message: 'Default language must be available' });

export const chapterSchema = z
  .object({ id: idSchema, title: localizedTextSchema, nodeIds: z.array(idSchema) })
  .strict();

export const courseStructureSchema = z.object({ chapters: z.array(chapterSchema).min(1).max(200) }).strict();

export const courseSchema = z
  .object({
    format: z.literal(COURSE_FORMAT),
    formatVersion: z.literal(CURRENT_FORMAT_VERSION),
    id: z.uuid(),
    meta: courseMetaSchema,
    languages: courseLanguagesSchema,
    settings: courseSettingsSchema,
    assets: z.record(sha256Schema, assetEntrySchema),
    structure: courseStructureSchema,
    nodes: z.record(idSchema, nodeSchema),
  })
  .strict()
  .superRefine((course, ctx) => {
    const seen = new Set<string>();
    course.structure.chapters.forEach((chapter, ci) => {
      chapter.nodeIds.forEach((nodeId, ni) => {
        const path = ['structure', 'chapters', ci, 'nodeIds', ni];
        if (!(nodeId in course.nodes)) {
          ctx.addIssue({ code: 'custom', message: `Unknown node ${nodeId}`, path });
        }
        if (seen.has(nodeId)) {
          ctx.addIssue({ code: 'custom', message: `Node ${nodeId} appears twice`, path });
        }
        seen.add(nodeId);
      });
    });
    for (const [key, node] of Object.entries(course.nodes)) {
      if (node.id !== key) {
        ctx.addIssue({ code: 'custom', message: 'Node key and id differ', path: ['nodes', key, 'id'] });
      }
      if (!seen.has(key)) {
        ctx.addIssue({ code: 'custom', message: 'Node is not part of any chapter', path: ['nodes', key] });
      }
    }
    for (const ref of collectAssetRefs(course)) {
      if (!(ref in course.assets)) {
        ctx.addIssue({ code: 'custom', message: `Missing asset ${ref}`, path: ['assets'] });
      }
    }
    if (course.settings.completion.type === 'quizPassed') {
      const target = course.nodes[course.settings.completion.quizId];
      if (target?.kind !== 'quiz' && target?.kind !== 'dialog') {
        ctx.addIssue({
          code: 'custom',
          message: 'Completion quiz not found',
          path: ['settings', 'completion'],
        });
      }
    }
  });
export type Course = z.infer<typeof courseSchema>;

/** All asset hashes referenced anywhere in the document. */
export function collectAssetRefs(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectAssetRefs(item, found);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$asset' && typeof child === 'string') found.add(child);
      else collectAssetRefs(child, found);
    }
  }
  return found;
}
