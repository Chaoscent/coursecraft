// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { questionSchema, type Question } from './nodes/quiz.js';
import { drawQuestions, quizResult, scoreQuestion, seededRandom, type Response } from './scoring.js';
import { quizNodeSchema } from './nodes/quiz.js';

const prompt = { de: { type: 'doc', content: [] } };
const q = (input: Record<string, unknown>): Question => questionSchema.parse({ id: 'q', prompt, ...input });
const score = (question: Question, response: Response) => scoreQuestion(question, response, 'de');

describe('scoreQuestion', () => {
  it('single choice', () => {
    const question = q({
      type: 'singleChoice',
      choices: [
        { id: 'a', text: { de: 'A' }, correct: true },
        { id: 'b', text: { de: 'B' }, correct: false },
      ],
    });
    expect(score(question, { type: 'singleChoice', choiceId: 'a' }).state).toBe('correct');
    expect(score(question, { type: 'singleChoice', choiceId: 'b' }).state).toBe('incorrect');
    expect(score(question, { type: 'singleChoice', choiceId: null }).score).toBe(0);
  });

  it('multiple choice with partial credit and penalties', () => {
    const question = q({
      type: 'multipleChoice',
      scoring: 'partial',
      points: 4,
      choices: [
        { id: 'a', text: { de: 'A' }, correct: true },
        { id: 'b', text: { de: 'B' }, correct: true },
        { id: 'c', text: { de: 'C' }, correct: false },
      ],
    });
    expect(score(question, { type: 'multipleChoice', choiceIds: ['a', 'b'] })).toEqual({
      score: 4,
      max: 4,
      state: 'correct',
    });
    expect(score(question, { type: 'multipleChoice', choiceIds: ['a'] })).toEqual({
      score: 2,
      max: 4,
      state: 'partial',
    });
    expect(score(question, { type: 'multipleChoice', choiceIds: ['a', 'c'] }).score).toBe(0);
  });

  it('all-or-nothing gives no points for partly right answers', () => {
    const question = q({
      type: 'multipleChoice',
      choices: [
        { id: 'a', text: { de: 'A' }, correct: true },
        { id: 'b', text: { de: 'B' }, correct: true },
      ],
    });
    expect(score(question, { type: 'multipleChoice', choiceIds: ['a'] })).toMatchObject({
      score: 0,
      state: 'partial',
    });
  });

  it('short answer normalizes whitespace and case', () => {
    const question = q({ type: 'shortAnswer', accepted: { de: ['Notausgang'] } });
    expect(score(question, { type: 'shortAnswer', text: '  notausgang ' }).state).toBe('correct');
    expect(score(question, { type: 'shortAnswer', text: '' }).state).toBe('incorrect');
  });

  it('fill in blanks, select blanks and word bank', () => {
    const fill = q({
      type: 'fillInBlanks',
      scoring: 'partial',
      points: 2,
      template: { de: '{{a}} {{b}}' },
      blanks: [
        { id: 'a', accepted: { de: ['x'] } },
        { id: 'b', accepted: { de: ['y'] } },
      ],
    });
    expect(score(fill, { type: 'fillInBlanks', blanks: { a: 'X', b: 'z' } })).toMatchObject({
      score: 1,
      state: 'partial',
    });
    const select = q({
      type: 'selectBlanks',
      template: { de: '{{a}}' },
      blanks: [
        {
          id: 'a',
          options: [
            { id: 'o1', text: { de: '1' }, correct: false },
            { id: 'o2', text: { de: '2' }, correct: true },
          ],
        },
      ],
    });
    expect(score(select, { type: 'selectBlanks', blanks: { a: 'o2' } }).state).toBe('correct');
    const bank = q({
      type: 'wordBank',
      template: { de: '{{a}}' },
      words: [
        { id: 'w1', text: { de: 'w' } },
        { id: 'w2', text: { de: 'v' } },
      ],
      blanks: [{ id: 'a', wordId: 'w2' }],
    });
    expect(score(bank, { type: 'wordBank', blanks: { a: 'w2' } }).state).toBe('correct');
  });

  it('matching, sequence and drag and drop', () => {
    const matching = q({
      type: 'matching',
      pairs: [
        { id: 'p1', left: { de: 'L1' }, right: { de: 'R1' } },
        { id: 'p2', left: { de: 'L2' }, right: { de: 'R2' } },
      ],
    });
    expect(score(matching, { type: 'matching', pairs: { p1: 'p1', p2: 'p2' } }).state).toBe('correct');
    expect(score(matching, { type: 'matching', pairs: { p1: 'p2', p2: 'p1' } }).state).toBe('incorrect');
    const sequence = q({
      type: 'sequence',
      items: [
        { id: 'a', text: { de: 'A' } },
        { id: 'b', text: { de: 'B' } },
      ],
    });
    expect(score(sequence, { type: 'sequence', order: ['a', 'b'] }).state).toBe('correct');
    expect(score(sequence, { type: 'sequence', order: ['b', 'a'] }).state).toBe('incorrect');
    const drag = q({
      type: 'dragDrop',
      zones: [{ id: 'z', frame: { x: 0, y: 0, width: 10, height: 10 }, label: { de: 'Z' } }],
      items: [
        { id: 'i1', content: { type: 'text', text: { de: 'I1' } }, correctZoneIds: ['z'] },
        { id: 'i2', content: { type: 'text', text: { de: 'Distraktor' } }, correctZoneIds: [] },
      ],
    });
    expect(score(drag, { type: 'dragDrop', placements: { i1: 'z', i2: null } }).state).toBe('correct');
    expect(score(drag, { type: 'dragDrop', placements: { i1: 'z', i2: 'z' } }).state).toBe('partial');
  });

  it('hotspot, numeric, true/false', () => {
    const hotspot = q({
      type: 'hotspot',
      image: { image: { $asset: 'a'.repeat(64) }, altText: { de: 'Bild' } },
      areas: [
        {
          id: 'h1',
          shape: { type: 'rectangle', topLeft: { x: 0, y: 0 }, bottomRight: { x: 0.5, y: 0.5 } },
          label: { de: 'A' },
          correct: true,
        },
        {
          id: 'h2',
          shape: { type: 'rectangle', topLeft: { x: 0.5, y: 0.5 }, bottomRight: { x: 1, y: 1 } },
          label: { de: 'B' },
          correct: false,
        },
      ],
    });
    expect(score(hotspot, { type: 'hotspot', areaIds: ['h1'] }).state).toBe('correct');
    const numeric = q({
      type: 'numeric',
      accepted: [
        { type: 'exact', value: 112, tolerance: 0 },
        { type: 'range', min: 1, max: 3 },
      ],
    });
    expect(score(numeric, { type: 'numeric', value: 2.5 }).state).toBe('correct');
    expect(score(numeric, { type: 'numeric', value: 110 }).state).toBe('incorrect');
    const tf = q({ type: 'trueFalse', correct: false });
    expect(score(tf, { type: 'trueFalse', value: false }).state).toBe('correct');
  });

  it('likert is not scored, essays wait for manual grading', () => {
    const likert = q({
      type: 'likert',
      statements: [{ id: 's', text: { de: 'S' } }],
      scale: [
        { id: '1', label: { de: '1' } },
        { id: '2', label: { de: '2' } },
      ],
    });
    expect(score(likert, { type: 'likert', answers: { s: '1' } })).toEqual({
      score: 0,
      max: 0,
      state: 'ungraded',
    });
    const essay = q({ type: 'essay', points: 5 });
    expect(score(essay, { type: 'essay', text: 'Mein Text' })).toEqual({
      score: 0,
      max: 5,
      state: 'pending',
    });
  });
});

describe('quiz', () => {
  const quiz = quizNodeSchema.parse({
    kind: 'quiz',
    id: 'quiz',
    title: { de: 'Quiz' },
    settings: { passingPercent: 50 },
    items: [
      { type: 'question', question: { id: 'q1', type: 'trueFalse', prompt, correct: true } },
      {
        type: 'pool',
        id: 'p',
        title: 'Pool',
        draw: 2,
        questions: ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'trueFalse', prompt, correct: true })),
      },
    ],
  });

  it('draws the configured number from pools, reproducibly per seed', () => {
    const first = drawQuestions(quiz, seededRandom(42)).map((x) => x.id);
    expect(first).toHaveLength(3);
    expect(drawQuestions(quiz, seededRandom(42)).map((x) => x.id)).toEqual(first);
  });

  it('computes scaled score and pass state', () => {
    const result = quizResult(quiz, [
      { score: 1, max: 1, state: 'correct' },
      { score: 0, max: 1, state: 'incorrect' },
    ]);
    expect(result).toMatchObject({ scaled: 0.5, passed: true, pending: false });
  });
});
