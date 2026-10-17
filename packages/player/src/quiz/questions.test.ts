// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { questionSchema, type Question } from '@coursecraft/course-model';
import { scoreQuestion, seededRandom } from '@coursecraft/course-model/scoring';
import { describe, expect, it } from 'vitest';
import { stringsFor } from '../runtime/strings.js';
import { scorm2004Response } from '../tracking/scorm2004.js';
import { renderQuestion, templateParts } from './questions.js';

const ctx = {
  lang: 'de',
  fallbackLang: 'de',
  assetUrl: (sha: string) => `assets/${sha}.png`,
  assetMime: () => 'image/png',
  branding: { accent: '#1f5fa6', text: '#1d1f22', background: '#ffffff' },
};
const prompt = {
  de: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Frage?' }] }] },
};
const q = (input: Record<string, unknown>): Question => questionSchema.parse({ id: 'q', prompt, ...input });
const render = (question: Question) => {
  const view = renderQuestion(question, ctx, stringsFor('de'), seededRandom(3));
  document.body.replaceChildren(view.root);
  return view;
};

describe('question rendering', () => {
  it('single choice uses native radios and reports the choice', () => {
    const question = q({
      type: 'singleChoice',
      choices: [
        { id: 'a', text: { de: 'A' }, correct: true },
        { id: 'b', text: { de: 'B' }, correct: false },
      ],
    });
    const view = render(question);
    expect(view.root.tagName).toBe('FIELDSET');
    expect(view.root.querySelector('legend')?.textContent).toContain('Frage?');
    expect(view.answered()).toBe(false);
    view.root.querySelector<HTMLInputElement>('input[value="a"]')?.click();
    expect(view.response()).toEqual({ type: 'singleChoice', choiceId: 'a' });
    expect(scoreQuestion(question, view.response(), 'de').state).toBe('correct');
  });

  it('fill-in blanks renders one labelled input per placeholder', () => {
    const question = q({
      type: 'fillInBlanks',
      template: { de: 'A {{x}} B {{y}}' },
      blanks: [
        { id: 'x', accepted: { de: ['1'] } },
        { id: 'y', accepted: { de: ['2'] } },
      ],
    });
    const view = render(question);
    const inputs = view.root.querySelectorAll<HTMLInputElement>('input');
    expect(inputs).toHaveLength(2);
    expect(inputs[0]?.getAttribute('aria-label')).toBe('Lücke 1');
    if (inputs[0]) inputs[0].value = '1';
    if (inputs[1]) inputs[1].value = '2';
    expect(scoreQuestion(question, view.response(), 'de').state).toBe('correct');
  });

  it('sequence can be ordered with buttons and never starts solved', () => {
    const question = q({
      type: 'sequence',
      items: [
        { id: 'a', text: { de: 'A' } },
        { id: 'b', text: { de: 'B' } },
      ],
    });
    const view = render(question);
    expect(scoreQuestion(question, view.response(), 'de').state).toBe('incorrect');
    view.root.querySelector<HTMLButtonElement>('button[aria-label^="Nach unten"]')?.click();
    expect(scoreQuestion(question, view.response(), 'de').state).toBe('correct');
  });

  it('drag and drop has a select alternative for every item', () => {
    const question = q({
      type: 'dragDrop',
      zones: [{ id: 'z', frame: { x: 0, y: 0, width: 100, height: 100 }, label: { de: 'Ziel' } }],
      items: [{ id: 'i', content: { type: 'text', text: { de: 'Ding' } }, correctZoneIds: ['z'] }],
    });
    const view = render(question);
    const select = view.root.querySelector<HTMLSelectElement>('select[aria-label="Ziel: Ding"]');
    expect(select).not.toBeNull();
    if (select) {
      select.value = 'z';
      select.dispatchEvent(new Event('change'));
    }
    expect(view.root.querySelector('[data-zone="z"] [data-item="i"]')).not.toBeNull();
    expect(scoreQuestion(question, view.response(), 'de').state).toBe('correct');
  });

  it('hotspot areas are labelled toggle buttons', () => {
    const question = q({
      type: 'hotspot',
      image: { image: { $asset: 'a'.repeat(64) }, altText: { de: 'Plan' } },
      areas: [
        {
          id: 'h',
          shape: { type: 'rectangle', topLeft: { x: 0, y: 0 }, bottomRight: { x: 0.5, y: 0.5 } },
          label: { de: 'Ausgang' },
          correct: true,
        },
      ],
    });
    const view = render(question);
    const button = view.root.querySelector<HTMLButtonElement>('button[aria-label="Ausgang"]');
    button?.click();
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(view.response()).toEqual({ type: 'hotspot', areaIds: ['h'] });
  });

  it('every question type renders without throwing and can be disabled', () => {
    const all = [
      q({
        type: 'multipleChoice',
        choices: [
          { id: 'a', text: { de: 'A' }, correct: true },
          { id: 'b', text: { de: 'B' }, correct: false },
        ],
      }),
      q({ type: 'trueFalse', correct: true }),
      q({ type: 'shortAnswer', accepted: { de: ['x'] } }),
      q({
        type: 'matching',
        pairs: [
          { id: 'p1', left: { de: 'a' }, right: { de: 'b' } },
          { id: 'p2', left: { de: 'c' }, right: { de: 'd' } },
        ],
      }),
      q({
        type: 'selectBlanks',
        template: { de: '{{a}}' },
        blanks: [
          {
            id: 'a',
            options: [
              { id: 'o', text: { de: 'o' }, correct: true },
              { id: 'p', text: { de: 'p' }, correct: false },
            ],
          },
        ],
      }),
      q({
        type: 'likert',
        statements: [{ id: 's', text: { de: 'S' } }],
        scale: [
          { id: '1', label: { de: '1' } },
          { id: '2', label: { de: '2' } },
        ],
      }),
      q({ type: 'numeric', accepted: [{ type: 'exact', value: 1 }] }),
      q({
        type: 'wordBank',
        template: { de: '{{a}}' },
        words: [{ id: 'w', text: { de: 'w' } }],
        blanks: [{ id: 'a', wordId: 'w' }],
      }),
      q({ type: 'essay' }),
    ];
    for (const question of all) {
      const view = render(question);
      view.disable();
      expect(
        [...view.root.querySelectorAll('input, select, textarea')].every(
          (el) => (el as HTMLInputElement).disabled,
        ),
      ).toBe(true);
      expect(() => view.reveal()).not.toThrow();
    }
  });
});

describe('templates and SCORM 2004 response formats', () => {
  it('splits templates into text and blanks', () => {
    expect(templateParts('Der {{a}} ist {{b}}.')).toEqual([
      { text: 'Der ' },
      { blank: 'a' },
      { text: ' ist ' },
      { blank: 'b' },
      { text: '.' },
    ]);
  });

  it('formats responses with SCORM 2004 delimiters', () => {
    expect(scorm2004Response({ type: 'multipleChoice', choiceIds: ['a', 'b c'] }, '')).toBe('a[,]b_c');
    expect(scorm2004Response({ type: 'matching', pairs: { p1: 'x', p2: 'y' } }, '')).toBe('p1[.]x[,]p2[.]y');
    expect(scorm2004Response({ type: 'trueFalse', value: false }, '')).toBe('false');
    expect(scorm2004Response({ type: 'sequence', order: ['b', 'a'] }, '')).toBe('b[,]a');
  });
});
