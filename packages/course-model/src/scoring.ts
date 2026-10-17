// SPDX-License-Identifier: Apache-2.0
// Pure scoring functions. Type-only imports: the player bundles this file
// without the schema library.
import type { Question, QuizNode } from './nodes/quiz.js';

export type Response =
  | { type: 'singleChoice'; choiceId: string | null }
  | { type: 'multipleChoice'; choiceIds: string[] }
  | { type: 'trueFalse'; value: boolean | null }
  | { type: 'shortAnswer'; text: string }
  | { type: 'matching'; pairs: Record<string, string> }
  | { type: 'sequence'; order: string[] }
  | { type: 'fillInBlanks'; blanks: Record<string, string> }
  | { type: 'selectBlanks'; blanks: Record<string, string> }
  | { type: 'dragDrop'; placements: Record<string, string | null> }
  | { type: 'hotspot'; areaIds: string[] }
  | { type: 'likert'; answers: Record<string, string> }
  | { type: 'numeric'; value: number | null }
  | { type: 'wordBank'; blanks: Record<string, string> }
  | { type: 'essay'; text: string };

export type ResultState = 'correct' | 'incorrect' | 'partial' | 'pending' | 'ungraded';

export interface QuestionResult {
  score: number;
  max: number;
  state: ResultState;
}

const normalize = (value: string, caseSensitive: boolean) => {
  const v = value.trim().replace(/\s+/g, ' ');
  return caseSensitive ? v : v.toLocaleLowerCase();
};

function accepted(list: Record<string, string[]>, lang: string, fallback: string): string[] {
  return list[lang] ?? list[fallback] ?? Object.values(list).flat();
}

function textMatches(
  input: string,
  list: Record<string, string[]>,
  caseSensitive: boolean,
  lang: string,
  fallback: string,
): boolean {
  const value = normalize(input, caseSensitive);
  return (
    value.length > 0 && accepted(list, lang, fallback).some((a) => normalize(a, caseSensitive) === value)
  );
}

/** Fraction (0..1) of the question answered correctly. */
function fraction(
  question: Exclude<Question, { type: 'likert' }>,
  response: Response,
  lang: string,
  fallback: string,
): number {
  switch (question.type) {
    case 'singleChoice': {
      if (response.type !== 'singleChoice') return 0;
      return question.choices.find((c) => c.id === response.choiceId)?.correct ? 1 : 0;
    }
    case 'multipleChoice': {
      if (response.type !== 'multipleChoice') return 0;
      const correct = question.choices.filter((c) => c.correct).map((c) => c.id);
      const right = response.choiceIds.filter((id) => correct.includes(id)).length;
      const wrong = response.choiceIds.filter((id) => !correct.includes(id)).length;
      return Math.max(0, (right - wrong) / correct.length);
    }
    case 'trueFalse':
      return response.type === 'trueFalse' && response.value === question.correct ? 1 : 0;
    case 'shortAnswer':
      return response.type === 'shortAnswer' &&
        textMatches(response.text, question.accepted, question.caseSensitive, lang, fallback)
        ? 1
        : 0;
    case 'matching': {
      if (response.type !== 'matching') return 0;
      const ok = question.pairs.filter((p) => response.pairs[p.id] === p.id).length;
      return ok / question.pairs.length;
    }
    case 'sequence': {
      if (response.type !== 'sequence') return 0;
      const ok = question.items.filter((item, i) => response.order[i] === item.id).length;
      return ok / question.items.length;
    }
    case 'fillInBlanks': {
      if (response.type !== 'fillInBlanks') return 0;
      const ok = question.blanks.filter((b) =>
        textMatches(response.blanks[b.id] ?? '', b.accepted, b.caseSensitive, lang, fallback),
      ).length;
      return ok / question.blanks.length;
    }
    case 'selectBlanks': {
      if (response.type !== 'selectBlanks') return 0;
      const ok = question.blanks.filter(
        (b) => b.options.find((o) => o.id === response.blanks[b.id])?.correct,
      ).length;
      return ok / question.blanks.length;
    }
    case 'dragDrop': {
      if (response.type !== 'dragDrop') return 0;
      const ok = question.items.filter((item) => {
        const zone = response.placements[item.id] ?? null;
        return item.correctZoneIds.length
          ? zone !== null && item.correctZoneIds.includes(zone)
          : zone === null;
      }).length;
      return ok / question.items.length;
    }
    case 'hotspot': {
      if (response.type !== 'hotspot') return 0;
      const correct = question.areas.filter((a) => a.correct).map((a) => a.id);
      if (!question.multiple)
        return response.areaIds.length === 1 && correct.includes(response.areaIds[0] ?? '') ? 1 : 0;
      const right = response.areaIds.filter((id) => correct.includes(id)).length;
      const wrong = response.areaIds.filter((id) => !correct.includes(id)).length;
      return correct.length ? Math.max(0, (right - wrong) / correct.length) : 0;
    }
    case 'numeric': {
      if (response.type !== 'numeric' || response.value === null || !Number.isFinite(response.value))
        return 0;
      const value = response.value;
      return question.accepted.some((a) =>
        a.type === 'exact' ? Math.abs(value - a.value) <= a.tolerance : value >= a.min && value <= a.max,
      )
        ? 1
        : 0;
    }
    case 'wordBank': {
      if (response.type !== 'wordBank') return 0;
      const ok = question.blanks.filter((b) => response.blanks[b.id] === b.wordId).length;
      return ok / question.blanks.length;
    }
    case 'essay':
      return 0;
  }
}

export function scoreQuestion(
  question: Question,
  response: Response,
  lang: string,
  fallback = lang,
): QuestionResult {
  if (question.type === 'likert') return { score: 0, max: 0, state: 'ungraded' };
  if (question.type === 'essay') return { score: 0, max: question.points, state: 'pending' };
  const f = fraction(question, response, lang, fallback);
  const max = question.points;
  if (f >= 1) return { score: max, max, state: 'correct' };
  if (question.scoring === 'partial' && f > 0)
    return { score: Math.round(max * f * 100) / 100, max, state: 'partial' };
  return { score: 0, max, state: f > 0 ? 'partial' : 'incorrect' };
}

export interface QuizResult {
  score: number;
  max: number;
  /** 0..1; 1 when nothing is scored. */
  scaled: number;
  passed: boolean;
  /** Essays await manual grading; the result may still change. */
  pending: boolean;
}

export function quizResult(quiz: QuizNode, results: QuestionResult[]): QuizResult {
  const score = results.reduce((n, r) => n + r.score, 0);
  const max = results.reduce((n, r) => n + r.max, 0);
  const scaled = max > 0 ? score / max : 1;
  return {
    score,
    max,
    scaled,
    passed: scaled * 100 >= quiz.settings.passingPercent,
    pending: results.some((r) => r.state === 'pending'),
  };
}

/** Deterministic shuffle with a seeded generator (resume shows the same order). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

/** The questions of one attempt: pools draw their configured number. */
export function drawQuestions(quiz: QuizNode, random: () => number): Question[] {
  const questions = quiz.items.flatMap((item) =>
    item.type === 'question' ? [item.question] : shuffle(item.questions, random).slice(0, item.draw),
  );
  return quiz.settings.shuffleItems ? shuffle(questions, random) : questions;
}

/** Response as plain text, e.g. for SCORM learner_response and reports. */
export function describeResponse(response: Response): string {
  switch (response.type) {
    case 'singleChoice':
      return response.choiceId ?? '';
    case 'multipleChoice':
      return response.choiceIds.join(',');
    case 'trueFalse':
      return response.value === null ? '' : String(response.value);
    case 'shortAnswer':
    case 'essay':
      return response.text;
    case 'numeric':
      return response.value === null ? '' : String(response.value);
    case 'sequence':
      return response.order.join(',');
    case 'hotspot':
      return response.areaIds.join(',');
    case 'matching':
      return Object.entries(response.pairs)
        .map(([k, v]) => `${k}.${v}`)
        .join(',');
    case 'dragDrop':
      return Object.entries(response.placements)
        .map(([k, v]) => `${k}.${v ?? ''}`)
        .join(',');
    case 'likert':
      return Object.entries(response.answers)
        .map(([k, v]) => `${k}.${v}`)
        .join(',');
    case 'fillInBlanks':
    case 'selectBlanks':
    case 'wordBank':
      return Object.entries(response.blanks)
        .map(([k, v]) => `${k}.${v}`)
        .join(',');
  }
}
