// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { dialogNodeSchema, type DialogNode } from '@coursecraft/course-model';
import { describe, expect, it, vi } from 'vitest';
import type { NodeApi } from '../runtime/player.js';
import { stringsFor } from '../runtime/strings.js';
import type { InteractionRecord } from '../tracking/types.js';
import { maxScore, outcomeFor, renderDialog } from './dialog.js';

const ctx = {
  lang: 'de',
  fallbackLang: 'de',
  assetUrl: (sha: string) => `assets/${sha}`,
  assetMime: () => 'image/png',
  branding: { accent: '#1f5fa6', text: '#1d1f22', background: '#ffffff' },
};
const doc = (text: string) => ({
  de: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
});
const sha = 'a'.repeat(64);

const dialog: DialogNode = dialogNodeSchema.parse({
  kind: 'dialog',
  id: 'd1',
  title: { de: 'Kundengespräch' },
  characters: [
    { id: 'c', name: { de: 'Frau Berg' }, images: { neutral: { $asset: sha } }, altText: { de: 'Porträt' } },
  ],
  startSceneId: 's1',
  scenes: [
    {
      id: 's1',
      characterId: 'c',
      speech: { de: 'Mein Gerät ist defekt.' },
      position: { x: 0, y: 0 },
      responses: [
        { id: 'r1', text: { de: 'Das tut mir leid.' }, points: 2, next: { type: 'scene', sceneId: 's2' } },
        {
          id: 'r2',
          text: { de: 'Nicht mein Problem.' },
          points: -1,
          feedback: doc('Unhöflich.'),
          next: { type: 'end' },
        },
      ],
    },
    {
      id: 's2',
      characterId: 'c',
      speech: { de: 'Was nun?' },
      position: { x: 0, y: 0 },
      responses: [
        { id: 'r3', text: { de: 'Austausch' }, points: 3, next: { type: 'end' } },
        // A loop back must not inflate the maximum.
        { id: 'r4', text: { de: 'Noch einmal' }, points: 1, next: { type: 'scene', sceneId: 's1' } },
      ],
    },
  ],
  outcomes: [
    { id: 'o1', title: { de: 'Super' }, body: doc('Gut gelöst.'), minScore: 4, passed: true },
    { id: 'o2', title: { de: 'Schade' }, body: doc('Üben.'), minScore: 0, passed: false },
  ],
});

function api() {
  return {
    ctx,
    strings: stringsFor('de'),
    markViewed: vi.fn(),
    allowNext: vi.fn(),
    next: vi.fn(),
    goTo: vi.fn(),
    finish: vi.fn(),
    reportScore: vi.fn(),
  } satisfies NodeApi;
}

const click = (root: HTMLElement, label: string) => {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`No button ${label}`);
  button.click();
};

describe('dialog simulation', () => {
  it('computes the best reachable score without following loops', () => {
    expect(maxScore(dialog)).toBe(5);
  });

  it('picks the highest reached outcome and falls back to the lowest', () => {
    expect(outcomeFor(dialog, 5)?.id).toBe('o1');
    expect(outcomeFor(dialog, 2)?.id).toBe('o2');
    expect(outcomeFor(dialog, -3)?.id).toBe('o2');
  });

  it('plays a path, tracks each choice and reports the scaled score', () => {
    const a = api();
    const records: InteractionRecord[] = [];
    const root = renderDialog(dialog, a, (r) => records.push(r));
    expect(root.textContent).toContain('Mein Gerät ist defekt.');
    click(root, 'Das tut mir leid.');
    expect(root.textContent).toContain('Was nun?');
    click(root, 'Austausch');
    expect(a.reportScore).toHaveBeenCalledWith('d1', { scaled: 1, passed: true });
    expect(a.allowNext).toHaveBeenCalled();
    expect(root.textContent).toContain('Super');
    expect(root.textContent).toContain('5 von 5 Punkten');
    expect(records.map((r) => [r.id, r.response, r.result, r.parentId])).toEqual([
      ['s1', 'r1', 'correct', 'd1'],
      ['s2', 'r3', 'correct', 'd1'],
    ]);
  });

  it('shows feedback before moving on and clamps negative scores', () => {
    const a = api();
    const root = renderDialog(dialog, a, () => undefined);
    click(root, 'Nicht mein Problem.');
    expect(root.textContent).toContain('Unhöflich.');
    expect(a.reportScore).not.toHaveBeenCalled();
    click(root, 'Weiter');
    expect(a.reportScore).toHaveBeenCalledWith('d1', { scaled: 0, passed: false });
    click(root, 'Gespräch wiederholen');
    expect(root.textContent).toContain('Mein Gerät ist defekt.');
  });
});
