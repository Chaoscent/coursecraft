// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { questionSchema } from './nodes/quiz.js';

const prompt = { de: { type: 'doc', content: [] } };

describe('question rules', () => {
  it('requires exactly one correct single-choice answer', () => {
    const q = {
      id: 'q',
      type: 'singleChoice',
      prompt,
      choices: [
        { id: 'a', text: { de: 'A' }, correct: true },
        { id: 'b', text: { de: 'B' }, correct: true },
      ],
    };
    expect(questionSchema.safeParse(q).success).toBe(false);
  });

  it('keeps likert items unscored', () => {
    const q = {
      id: 'q',
      type: 'likert',
      prompt,
      points: 5,
      statements: [{ id: 's', text: { de: 'S' } }],
      scale: [
        { id: '1', label: { de: '1' } },
        { id: '2', label: { de: '2' } },
      ],
    };
    expect(questionSchema.safeParse(q).success).toBe(false);
  });

  it('defines fourteen question types', () => {
    expect(questionSchema.options).toHaveLength(14);
  });
});
