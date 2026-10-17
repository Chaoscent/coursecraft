// SPDX-License-Identifier: Apache-2.0
import type { Question, QuizNode, RichText, SurveyNode } from '@lernwerk/course-model';
import type { AiQuestion } from '@lernwerk/shared';
import { newId } from './ids.js';
import { paragraphDoc } from './model.js';

export const QUESTION_TYPES = [
  'singleChoice',
  'multipleChoice',
  'trueFalse',
  'shortAnswer',
  'matching',
  'sequence',
  'fillInBlanks',
  'selectBlanks',
  'dragDrop',
  'hotspot',
  'likert',
  'numeric',
  'wordBank',
  'essay',
] as const satisfies readonly Question['type'][];

export type QuestionType = (typeof QUESTION_TYPES)[number];

const text = (lang: string, value: string) => ({ [lang]: value });

const graded = (lang: string, prompt: string) => ({
  id: newId('q'),
  prompt: { [lang]: paragraphDoc(prompt) },
  points: 1,
  attempts: 1,
  scoring: 'allOrNothing' as const,
  feedback: {},
});

/**
 * A new question with sensible placeholder content, valid against the
 * course format so the course can be saved immediately.
 */
export function newQuestion(
  type: QuestionType,
  lang: string,
  labels: { prompt: string; option: string; blankText: string },
): Question {
  const base = graded(lang, labels.prompt);
  const option = (n: number, correct = false) => ({
    id: newId('o'),
    text: text(lang, `${labels.option} ${n}`),
    correct,
  });
  switch (type) {
    case 'singleChoice':
      return { ...base, type, choices: [option(1, true), option(2), option(3)], shuffle: true };
    case 'multipleChoice':
      return { ...base, type, choices: [option(1, true), option(2, true), option(3)], shuffle: true };
    case 'trueFalse':
      return { ...base, type, correct: true };
    case 'shortAnswer':
      return { ...base, type, accepted: { [lang]: ['…'] }, caseSensitive: false };
    case 'numeric':
      return { ...base, type, accepted: [{ type: 'exact', value: 0, tolerance: 0 }] };
    case 'essay':
      return { ...base, type, maxLength: 5000 };
    case 'matching':
      return {
        ...base,
        type,
        pairs: [1, 2].map((n) => ({ id: newId('p'), left: text(lang, `A${n}`), right: text(lang, `B${n}`) })),
        distractors: [],
      };
    case 'sequence':
      return {
        ...base,
        type,
        items: [1, 2, 3].map((n) => ({ id: newId('i'), text: text(lang, `${labels.option} ${n}`) })),
      };
    case 'fillInBlanks':
      return {
        ...base,
        type,
        template: text(lang, `${labels.blankText} {{b1}}.`),
        blanks: [{ id: 'b1', accepted: { [lang]: ['…'] }, caseSensitive: false }],
      };
    case 'selectBlanks':
      return {
        ...base,
        type,
        template: text(lang, `${labels.blankText} {{b1}}.`),
        blanks: [{ id: 'b1', options: [option(1, true), option(2)] }],
      };
    case 'wordBank': {
      const words = [1, 2, 3].map((n) => ({ id: newId('w'), text: text(lang, `${labels.option} ${n}`) }));
      return {
        ...base,
        type,
        template: text(lang, `${labels.blankText} {{b1}}.`),
        words,
        blanks: [{ id: 'b1', wordId: words[0]?.id ?? '' }],
      };
    }
    case 'dragDrop': {
      const zones = [0, 1].map((n) => ({
        id: newId('z'),
        frame: { x: 20 + n * 400, y: 20, width: 360, height: 220, rotation: 0 },
        label: text(lang, `${labels.option} ${n + 1}`),
      }));
      return {
        ...base,
        type,
        zones,
        items: zones.map((z, n) => ({
          id: newId('d'),
          content: { type: 'text' as const, text: text(lang, `${labels.option} ${n + 1}`) },
          correctZoneIds: [z.id],
        })),
      };
    }
    case 'hotspot':
      // Needs an image; the editor asks for one before creating it.
      throw new Error('Use newHotspotQuestion');
    case 'likert':
      return {
        id: newId('q'),
        type,
        prompt: { [lang]: paragraphDoc(labels.prompt) },
        statements: [{ id: newId('s'), text: text(lang, `${labels.option} 1`) }],
        scale: ['1', '2', '3', '4', '5'].map((n) => ({ id: newId('l'), label: text(lang, n) })),
      };
  }
}

export function newHotspotQuestion(lang: string, prompt: string, sha256: string): Question {
  return {
    ...graded(lang, prompt),
    type: 'hotspot',
    image: { image: { $asset: sha256 }, altText: {} },
    areas: [
      {
        id: newId('h'),
        shape: { type: 'rectangle', topLeft: { x: 0.1, y: 0.1 }, bottomRight: { x: 0.3, y: 0.3 } },
        label: text(lang, 'A'),
        correct: true,
      },
    ],
    multiple: false,
  };
}

/** An AI draft as an editable question: single choice with one correct answer, else multiple choice. */
export function questionFromDraft(lang: string, draft: AiQuestion): Question {
  const feedback = draft.feedback
    ? {
        correct: { [lang]: paragraphDoc(draft.feedback) },
        incorrect: { [lang]: paragraphDoc(draft.feedback) },
      }
    : {};
  const choices = draft.choices.map((c) => ({
    id: newId('o'),
    text: text(lang, c.text),
    correct: c.correct,
  }));
  return {
    ...graded(lang, draft.prompt),
    feedback,
    type: choices.filter((c) => c.correct).length === 1 ? 'singleChoice' : 'multipleChoice',
    choices,
    shuffle: true,
  };
}

export function newQuiz(lang: string, title: string, firstQuestion: Question): QuizNode {
  return {
    kind: 'quiz',
    id: newId('quiz'),
    title: text(lang, title),
    items: [{ type: 'question', question: firstQuestion }],
    settings: { passingPercent: 80, shuffleItems: false, showResults: true, allowReview: true },
  };
}

export function newSurvey(lang: string, title: string, prompt: string): SurveyNode {
  return {
    kind: 'survey',
    id: newId('survey'),
    title: text(lang, title),
    anonymous: false,
    questions: [
      {
        id: newId('q'),
        type: 'text',
        prompt: { [lang]: paragraphDoc(prompt) },
        multiline: true,
        maxLength: 2000,
      },
    ],
  };
}

/** Rich text ↔ plain multi-line text for compact form fields (one paragraph per line). */
export function richToPlain(doc: RichText | undefined): string {
  return (doc?.content ?? [])
    .map((block) =>
      'content' in block && Array.isArray(block.content)
        ? block.content.map((n) => ('text' in n ? n.text : '')).join('')
        : '',
    )
    .join('\n');
}

export function plainToRich(value: string): RichText {
  return {
    type: 'doc',
    content: value
      .split('\n')
      .map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })),
  };
}

/** Blank ids referenced in a template, in order. */
export function placeholders(template: string): string[] {
  return [...template.matchAll(/\{\{([A-Za-z0-9_-]+)\}\}/g)].map((m) => m[1] ?? '');
}
