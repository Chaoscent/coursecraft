// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import {
  assetRefSchema,
  frameSchema,
  idSchema,
  localizedStringListSchema,
  localizedTextSchema,
  relativePointSchema,
} from '../primitives.js';
import { localizedRichTextSchema } from '../rich-text.js';
import { navigationTargetSchema } from './slide.js';

const feedbackSchema = z
  .object({
    correct: localizedRichTextSchema.optional(),
    incorrect: localizedRichTextSchema.optional(),
    partial: localizedRichTextSchema.optional(),
  })
  .strict();

const imageWithAltSchema = z.object({ image: assetRefSchema, altText: localizedTextSchema }).strict();

/** Fields shared by every graded question type. */
const gradedBase = {
  id: idSchema,
  prompt: localizedRichTextSchema,
  media: imageWithAltSchema.optional(),
  points: z.number().min(0).max(1000).default(1),
  attempts: z.number().int().min(1).max(10).default(1),
  timeLimitSec: z.number().int().min(5).max(7200).optional(),
  scoring: z.enum(['allOrNothing', 'partial']).default('allOrNothing'),
  feedback: feedbackSchema.default({}),
  branching: z
    .object({ onCorrect: navigationTargetSchema.optional(), onIncorrect: navigationTargetSchema.optional() })
    .strict()
    .optional(),
};

const choiceSchema = z
  .object({
    id: idSchema,
    text: localizedTextSchema,
    correct: z.boolean(),
    feedback: localizedRichTextSchema.optional(),
  })
  .strict();

/**
 * Templates for blank-based questions contain placeholders like `{{b1}}`
 * that reference blank ids. One template per language keeps word order
 * translatable.
 */
const blankTemplateSchema = localizedTextSchema;

const singleChoiceSchema = z
  .object({
    ...gradedBase,
    type: z.literal('singleChoice'),
    choices: z.array(choiceSchema).min(2).max(20),
    shuffle: z.boolean().default(true),
  })
  .strict()
  .refine((q) => q.choices.filter((c) => c.correct).length === 1, {
    message: 'Exactly one choice must be correct',
  });

const multipleChoiceSchema = z
  .object({
    ...gradedBase,
    type: z.literal('multipleChoice'),
    choices: z.array(choiceSchema).min(2).max(20),
    shuffle: z.boolean().default(true),
  })
  .strict()
  .refine((q) => q.choices.some((c) => c.correct), { message: 'At least one choice must be correct' });

const trueFalseSchema = z
  .object({ ...gradedBase, type: z.literal('trueFalse'), correct: z.boolean() })
  .strict();

const shortAnswerSchema = z
  .object({
    ...gradedBase,
    type: z.literal('shortAnswer'),
    accepted: localizedStringListSchema,
    caseSensitive: z.boolean().default(false),
  })
  .strict();

const matchingSchema = z
  .object({
    ...gradedBase,
    type: z.literal('matching'),
    pairs: z
      .array(z.object({ id: idSchema, left: localizedTextSchema, right: localizedTextSchema }).strict())
      .min(2)
      .max(20),
    /** Extra right-hand options without a partner. */
    distractors: z
      .array(z.object({ id: idSchema, text: localizedTextSchema }).strict())
      .max(10)
      .default([]),
  })
  .strict();

const sequenceSchema = z
  .object({
    ...gradedBase,
    type: z.literal('sequence'),
    /** Items in their correct order. */
    items: z
      .array(z.object({ id: idSchema, text: localizedTextSchema }).strict())
      .min(2)
      .max(20),
  })
  .strict();

const fillInBlanksSchema = z
  .object({
    ...gradedBase,
    type: z.literal('fillInBlanks'),
    template: blankTemplateSchema,
    blanks: z
      .array(
        z
          .object({
            id: idSchema,
            accepted: localizedStringListSchema,
            caseSensitive: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();

const selectBlanksSchema = z
  .object({
    ...gradedBase,
    type: z.literal('selectBlanks'),
    template: blankTemplateSchema,
    blanks: z
      .array(z.object({ id: idSchema, options: z.array(choiceSchema).min(2).max(15) }).strict())
      .min(1)
      .max(30),
  })
  .strict()
  .refine((q) => q.blanks.every((b) => b.options.filter((o) => o.correct).length === 1), {
    message: 'Each dropdown needs exactly one correct option',
  });

const draggableContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: localizedTextSchema }).strict(),
  z.object({ type: z.literal('image'), image: assetRefSchema, altText: localizedTextSchema }).strict(),
]);

const dragDropSchema = z
  .object({
    ...gradedBase,
    type: z.literal('dragDrop'),
    background: imageWithAltSchema.optional(),
    zones: z
      .array(z.object({ id: idSchema, frame: frameSchema, label: localizedTextSchema }).strict())
      .min(1)
      .max(30),
    items: z
      .array(
        z
          .object({
            id: idSchema,
            content: draggableContentSchema,
            correctZoneIds: z.array(idSchema).max(30),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict();

const hotspotAreaShapeSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('rectangle'), topLeft: relativePointSchema, bottomRight: relativePointSchema })
    .strict(),
  z
    .object({
      type: z.literal('ellipse'),
      center: relativePointSchema,
      rx: z.number().min(0).max(1),
      ry: z.number().min(0).max(1),
    })
    .strict(),
  z.object({ type: z.literal('polygon'), points: z.array(relativePointSchema).min(3).max(64) }).strict(),
]);

const hotspotQuestionSchema = z
  .object({
    ...gradedBase,
    type: z.literal('hotspot'),
    image: imageWithAltSchema,
    areas: z
      .array(
        z
          .object({
            id: idSchema,
            shape: hotspotAreaShapeSchema,
            label: localizedTextSchema,
            correct: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    multiple: z.boolean().default(false),
  })
  .strict();

const numericSchema = z
  .object({
    ...gradedBase,
    type: z.literal('numeric'),
    accepted: z
      .array(
        z.discriminatedUnion('type', [
          z
            .object({
              type: z.literal('exact'),
              value: z.number().finite(),
              tolerance: z.number().min(0).default(0),
            })
            .strict(),
          z.object({ type: z.literal('range'), min: z.number().finite(), max: z.number().finite() }).strict(),
        ]),
      )
      .min(1)
      .max(10),
  })
  .strict();

const wordBankSchema = z
  .object({
    ...gradedBase,
    type: z.literal('wordBank'),
    template: blankTemplateSchema,
    words: z
      .array(z.object({ id: idSchema, text: localizedTextSchema }).strict())
      .min(1)
      .max(40),
    blanks: z
      .array(z.object({ id: idSchema, wordId: idSchema }).strict())
      .min(1)
      .max(30),
  })
  .strict();

const essaySchema = z
  .object({
    ...gradedBase,
    type: z.literal('essay'),
    maxLength: z.number().int().min(1).max(50_000).default(5000),
    /** Guidance for graders; not shown to learners. */
    gradingNotes: localizedRichTextSchema.optional(),
  })
  .strict();

const likertScaleSchema = z
  .array(z.object({ id: idSchema, label: localizedTextSchema }).strict())
  .min(2)
  .max(11);

/** Likert items collect opinions and are never scored. */
const likertSchema = z
  .object({
    id: idSchema,
    type: z.literal('likert'),
    prompt: localizedRichTextSchema,
    statements: z
      .array(z.object({ id: idSchema, text: localizedTextSchema }).strict())
      .min(1)
      .max(30),
    scale: likertScaleSchema,
  })
  .strict();

export const questionSchema = z.union([
  singleChoiceSchema,
  multipleChoiceSchema,
  trueFalseSchema,
  shortAnswerSchema,
  matchingSchema,
  sequenceSchema,
  fillInBlanksSchema,
  selectBlanksSchema,
  dragDropSchema,
  hotspotQuestionSchema,
  likertSchema,
  numericSchema,
  wordBankSchema,
  essaySchema,
]);
export type Question = z.infer<typeof questionSchema>;
export type QuestionType = Question['type'];

const quizItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('question'), question: questionSchema }).strict(),
  /** Draws `draw` random questions from the pool for each attempt. */
  z
    .object({
      type: z.literal('pool'),
      id: idSchema,
      title: z.string().max(200),
      draw: z.number().int().min(1),
      questions: z.array(questionSchema).min(1).max(500),
    })
    .strict()
    .refine((p) => p.draw <= p.questions.length, { message: 'Pool draws more questions than it holds' }),
]);

export const quizNodeSchema = z
  .object({
    kind: z.literal('quiz'),
    id: idSchema,
    title: localizedTextSchema,
    intro: localizedRichTextSchema.optional(),
    items: z.array(quizItemSchema).min(1).max(500),
    settings: z
      .object({
        passingPercent: z.number().min(0).max(100).default(80),
        timeLimitSec: z
          .number()
          .int()
          .min(10)
          .max(24 * 3600)
          .optional(),
        attemptsAllowed: z.number().int().min(1).max(100).optional(),
        shuffleItems: z.boolean().default(false),
        showResults: z.boolean().default(true),
        allowReview: z.boolean().default(true),
      })
      .strict(),
  })
  .strict();
export type QuizNode = z.infer<typeof quizNodeSchema>;

const surveyQuestionSchema = z.discriminatedUnion('type', [
  z
    .object({
      id: idSchema,
      type: z.literal('choice'),
      prompt: localizedRichTextSchema,
      multiple: z.boolean().default(false),
      options: z
        .array(z.object({ id: idSchema, text: localizedTextSchema }).strict())
        .min(2)
        .max(30),
    })
    .strict(),
  z
    .object({
      id: idSchema,
      type: z.literal('text'),
      prompt: localizedRichTextSchema,
      multiline: z.boolean().default(false),
      maxLength: z.number().int().min(1).max(10_000).default(2000),
    })
    .strict(),
  likertSchema,
]);

export const surveyNodeSchema = z
  .object({
    kind: z.literal('survey'),
    id: idSchema,
    title: localizedTextSchema,
    intro: localizedRichTextSchema.optional(),
    questions: z.array(surveyQuestionSchema).min(1).max(200),
    anonymous: z.boolean().default(false),
  })
  .strict();
export type SurveyNode = z.infer<typeof surveyNodeSchema>;
