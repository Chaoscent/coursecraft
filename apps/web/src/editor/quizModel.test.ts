// SPDX-License-Identifier: Apache-2.0
import { questionSchema } from '@lernwerk/course-model';
import { describe, expect, it } from 'vitest';
import { questionFromDraft } from './quizModel.js';

describe('AI question drafts', () => {
  it('become valid single or multiple choice questions with feedback', () => {
    const single = questionFromDraft('de', {
      prompt: 'Notruf?',
      choices: [
        { text: '112', correct: true },
        { text: '110', correct: false },
      ],
      feedback: 'Europaweit 112.',
    });
    expect(single.type).toBe('singleChoice');
    expect(questionSchema.safeParse(single).success).toBe(true);
    const multiple = questionFromDraft('de', {
      prompt: 'Brandklassen?',
      choices: [
        { text: 'A', correct: true },
        { text: 'B', correct: true },
        { text: 'Z', correct: false },
      ],
    });
    expect(multiple.type).toBe('multipleChoice');
    expect(questionSchema.safeParse(multiple).success).toBe(true);
  });
});
