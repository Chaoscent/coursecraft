// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import {
  assetRefSchema,
  colorSchema,
  durationMsSchema,
  frameSchema,
  idSchema,
  langSchema,
  localizedTextSchema,
} from '../primitives.js';
import { linkHrefSchema, localizedRichTextSchema } from '../rich-text.js';

export const navigationTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('next') }).strict(),
  z.object({ type: z.literal('previous') }).strict(),
  z.object({ type: z.literal('node'), nodeId: idSchema }).strict(),
  z.object({ type: z.literal('finish') }).strict(),
]);

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('showElement'), elementId: idSchema }).strict(),
  z.object({ type: z.literal('hideElement'), elementId: idSchema }).strict(),
  z.object({ type: z.literal('toggleElement'), elementId: idSchema }).strict(),
  z.object({ type: z.literal('showLayer'), layerId: idSchema }).strict(),
  z.object({ type: z.literal('hideLayer'), layerId: idSchema }).strict(),
  z.object({ type: z.literal('playMedia'), elementId: idSchema }).strict(),
  z.object({ type: z.literal('pauseMedia'), elementId: idSchema }).strict(),
  z.object({ type: z.literal('seekTimeline'), atMs: durationMsSchema }).strict(),
  z.object({ type: z.literal('navigate'), target: navigationTargetSchema }).strict(),
  /** Opens in a new tab only after a user action; never fetched by the player. */
  z.object({ type: z.literal('openLink'), href: linkHrefSchema }).strict(),
]);

const triggerSchema = z
  .object({
    id: idSchema,
    event: z.discriminatedUnion('type', [
      z.object({ type: z.literal('click') }).strict(),
      z.object({ type: z.literal('mediaEnded') }).strict(),
      z.object({ type: z.literal('timeline'), atMs: durationMsSchema }).strict(),
    ]),
    actions: z.array(actionSchema).min(1).max(20),
  })
  .strict();

const animationSchema = z
  .object({
    effect: z.enum(['fade', 'fly', 'wipe', 'zoom']),
    direction: z.enum(['left', 'right', 'up', 'down']).optional(),
    durationMs: z.number().int().min(50).max(10_000).default(400),
  })
  .strict();

const textStyleSchema = z
  .object({
    font: z.enum(['sans', 'serif', 'mono']).default('sans'),
    sizePx: z.number().min(6).max(400).default(24),
    lineHeight: z.number().min(0.8).max(3).default(1.3),
    color: colorSchema.default('theme:text'),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).default('top'),
    paddingPx: z.number().min(0).max(200).default(8),
  })
  .strict();

const strokeSchema = z.object({ color: colorSchema, widthPx: z.number().min(0).max(100) }).strict();

const elementBase = {
  id: idSchema,
  name: z.string().max(200),
  frame: frameSchema,
  hidden: z.boolean().default(false),
  locked: z.boolean().default(false),
  /** Appearance on the slide timeline. */
  timing: z
    .object({ startMs: durationMsSchema, endMs: durationMsSchema.optional() })
    .strict()
    .default({ startMs: 0 }),
  entrance: animationSchema.optional(),
  exit: animationSchema.optional(),
  triggers: z.array(triggerSchema).max(20).default([]),
};

/** Text alternative or explicit marking as decorative (WCAG 1.1.1). */
const accessibleBase = {
  altText: localizedTextSchema.optional(),
  decorative: z.boolean().default(false),
};

const textElementSchema = z
  .object({
    ...elementBase,
    type: z.literal('text'),
    content: localizedRichTextSchema,
    style: textStyleSchema,
  })
  .strict();

const imageElementSchema = z
  .object({
    ...elementBase,
    ...accessibleBase,
    type: z.literal('image'),
    image: assetRefSchema,
    fit: z.enum(['contain', 'cover', 'fill']).default('contain'),
  })
  .strict();

const shapeElementSchema = z
  .object({
    ...elementBase,
    ...accessibleBase,
    type: z.literal('shape'),
    shape: z.enum(['rectangle', 'ellipse', 'triangle', 'line', 'arrow']),
    fill: colorSchema.optional(),
    stroke: strokeSchema.optional(),
    content: localizedRichTextSchema.optional(),
    textStyle: textStyleSchema.optional(),
  })
  .strict();

/** Media sources may differ per course language. */
const localizedAssetSchema = z.record(langSchema, assetRefSchema);

const mediaOptions = {
  autoplay: z.boolean().default(false),
  loop: z.boolean().default(false),
  controls: z.boolean().default(true),
};

const videoElementSchema = z
  .object({
    ...elementBase,
    ...mediaOptions,
    type: z.literal('video'),
    sources: localizedAssetSchema,
    poster: assetRefSchema.optional(),
    /** WebVTT captions per language. */
    captions: localizedAssetSchema.default({}),
    title: localizedTextSchema,
  })
  .strict();

const audioElementSchema = z
  .object({
    ...elementBase,
    ...mediaOptions,
    type: z.literal('audio'),
    sources: localizedAssetSchema,
    transcript: localizedRichTextSchema.optional(),
    title: localizedTextSchema,
  })
  .strict();

const hotspotElementSchema = z
  .object({
    ...elementBase,
    type: z.literal('hotspot'),
    shape: z.enum(['rectangle', 'ellipse']),
    /** Accessible name; hotspots are focusable buttons in the player. */
    label: localizedTextSchema,
  })
  .strict();

export type Element =
  | z.infer<typeof textElementSchema>
  | z.infer<typeof imageElementSchema>
  | z.infer<typeof shapeElementSchema>
  | z.infer<typeof videoElementSchema>
  | z.infer<typeof audioElementSchema>
  | z.infer<typeof hotspotElementSchema>
  | GroupElement;

export interface GroupElement extends z.infer<z.ZodObject<typeof elementBase>> {
  type: 'group';
  children: Element[];
}

const groupElementSchema: z.ZodType<GroupElement> = z
  .object({
    ...elementBase,
    type: z.literal('group'),
    get children() {
      return z.array(elementSchema).min(1).max(200);
    },
  })
  .strict();

export const elementSchema: z.ZodType<Element> = z.union([
  textElementSchema,
  imageElementSchema,
  shapeElementSchema,
  videoElementSchema,
  audioElementSchema,
  hotspotElementSchema,
  groupElementSchema,
]);

/** Overlay layer shown or hidden by triggers (e.g. a popup on a slide). */
const layerSchema = z
  .object({
    id: idSchema,
    name: z.string().max(200),
    visibleInitially: z.boolean().default(false),
    elements: z.array(elementSchema).max(500),
  })
  .strict();

export const slideNodeSchema = z
  .object({
    kind: z.literal('slide'),
    id: idSchema,
    title: localizedTextSchema,
    background: z
      .object({ color: colorSchema.optional(), image: assetRefSchema.optional() })
      .strict()
      .default({}),
    elements: z.array(elementSchema).max(500),
    layers: z.array(layerSchema).max(20).default([]),
    /** Voice-over for the slide; animations sync to its timeline. */
    narration: z
      .object({ sources: localizedAssetSchema, captions: localizedAssetSchema.default({}) })
      .strict()
      .optional(),
    durationMs: durationMsSchema.optional(),
    advance: z.enum(['manual', 'afterTimeline']).default('manual'),
    notes: localizedRichTextSchema.optional(),
    /** Image rendered from the imported presentation, used as fallback. */
    fallbackImage: assetRefSchema.optional(),
    useFallbackImage: z.boolean().default(false),
  })
  .strict();
export type SlideNode = z.infer<typeof slideNodeSchema>;
