// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { uuidSchema } from './common.js';

/** Wire protocols the AI adapter speaks. `openai` covers compatible servers (Ollama, llama.cpp, vLLM). */
export const AI_PROVIDER_KINDS = ['anthropic', 'openai'] as const;
export const aiProviderKindSchema = z.enum(AI_PROVIDER_KINDS);
export type AiProviderKind = z.infer<typeof aiProviderKindSchema>;

/** What a user may ask for. Each task has a fixed prompt on the server. */
export const AI_TASKS = ['rewrite', 'questions'] as const;
export const aiTaskSchema = z.enum(AI_TASKS);
export type AiTask = z.infer<typeof aiTaskSchema>;

export const REWRITE_MODES = ['simplify', 'shorten', 'correct', 'formal', 'translate'] as const;

export const AI_LIMITS = {
  /** Characters of course text sent in one request. */
  inputChars: 12_000,
  /** Characters accepted back. */
  outputChars: 24_000,
  questions: 10,
} as const;

/** Provider as administrators see it. The key itself never leaves the server. */
export const aiProviderSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  kind: aiProviderKindSchema,
  baseUrl: z.string(),
  model: z.string(),
  enabled: z.boolean(),
  allowUserKeys: z.boolean(),
  dailyQuota: z.number().int().nullable(),
  key: z.object({ set: z.boolean(), last4: z.string().nullable() }),
  updatedAt: z.string(),
});
export type AiProvider = z.infer<typeof aiProviderSchema>;

export const aiProvidersResponseSchema = z.object({
  /** The operator switch (`LERNWERK_AI_ENABLED`); without it nothing can be enabled. */
  allowedByOperator: z.boolean(),
  providers: z.array(aiProviderSchema),
});

/** Base URLs: https, or http only for loopback and private hosts (local model servers). */
const baseUrlSchema = z
  .url({ protocol: /^https?$/ })
  .max(500)
  .refine((v) => {
    const url = new URL(v);
    return !url.username && !url.password && !url.search && !url.hash;
  }, 'No credentials, query or fragment in the base URL');

export const aiProviderInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    kind: aiProviderKindSchema,
    baseUrl: baseUrlSchema,
    model: z.string().trim().min(1).max(200),
    enabled: z.boolean(),
    allowUserKeys: z.boolean(),
    dailyQuota: z.number().int().min(1).max(100_000).nullable(),
    /** New key; omitted keeps the stored one, null removes it. */
    key: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .strict();
export type AiProviderInput = z.infer<typeof aiProviderInputSchema>;

/** What an author sees: available providers and whether a key is ready. */
export const aiStatusSchema = z.object({
  available: z.boolean(),
  providers: z.array(
    z.object({
      id: uuidSchema,
      name: z.string(),
      model: z.string(),
      allowUserKeys: z.boolean(),
      ready: z.boolean(),
      userKey: z.object({ set: z.boolean(), last4: z.string().nullable() }),
      remainingToday: z.number().int().nullable(),
    }),
  ),
});
export type AiStatus = z.infer<typeof aiStatusSchema>;

export const aiUserKeyInputSchema = z.object({ key: z.string().trim().min(1).max(500).nullable() }).strict();

export const aiPreviewRequestSchema = z.discriminatedUnion('task', [
  z
    .object({
      task: z.literal('rewrite'),
      providerId: uuidSchema,
      courseId: uuidSchema,
      mode: z.enum(REWRITE_MODES),
      /** Target language for `translate` (BCP 47). */
      targetLang: z
        .string()
        .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/)
        .optional(),
      text: z.string().trim().min(1).max(AI_LIMITS.inputChars),
    })
    .strict(),
  z
    .object({
      task: z.literal('questions'),
      providerId: uuidSchema,
      courseId: uuidSchema,
      count: z.number().int().min(1).max(AI_LIMITS.questions),
      lang: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/),
      text: z.string().trim().min(1).max(AI_LIMITS.inputChars),
    })
    .strict(),
]);
export type AiPreviewRequest = z.infer<typeof aiPreviewRequestSchema>;

/** The exact request the server will send, shown before the user confirms. */
export const aiPreviewSchema = z.object({
  previewId: uuidSchema,
  provider: z.string(),
  endpoint: z.string(),
  /** Request body as JSON text, byte for byte what goes out (the key travels in a header). */
  body: z.string(),
  expiresAt: z.string(),
});
export type AiPreview = z.infer<typeof aiPreviewSchema>;

export const aiRunRequestSchema = z.object({ previewId: uuidSchema }).strict();

/** Generated multiple/single choice question; becomes an editable draft. */
export const aiQuestionSchema = z
  .object({
    prompt: z.string().trim().min(1).max(1000),
    choices: z
      .array(z.object({ text: z.string().trim().min(1).max(300), correct: z.boolean() }).strict())
      .min(2)
      .max(6)
      .refine((c) => c.some((x) => x.correct), 'At least one correct choice'),
    feedback: z.string().trim().max(1000).optional(),
  })
  .strict();
export type AiQuestion = z.infer<typeof aiQuestionSchema>;

export const aiRunResponseSchema = z.discriminatedUnion('task', [
  z.object({ task: z.literal('rewrite'), text: z.string().max(AI_LIMITS.outputChars) }),
  z.object({
    task: z.literal('questions'),
    questions: z.array(aiQuestionSchema).max(AI_LIMITS.questions),
  }),
]);
export type AiRunResponse = z.infer<typeof aiRunResponseSchema>;
