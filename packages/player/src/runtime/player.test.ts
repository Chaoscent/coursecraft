// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { loadCourse } from '@coursecraft/course-model';
import { beforeAll, describe, expect, it } from 'vitest';
import { noTracking } from '../tracking/types.js';
import fixture from '../../../course-model/fixtures/v1-sample.json';
import { Player } from './player.js';

const sample = () => loadCourse(structuredClone(fixture));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
  }
});

describe('player navigation', () => {
  it('moves the outline marker to nodes that are not viewed on entry', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const player = new Player(root, { course: sample(), tracker: noTracking, assetUrl: (s) => s });
    const current = () => root.querySelector('.cc-outline-item[aria-current="step"]')?.textContent;
    expect(current()).toBe('Willkommen');
    player.goTo(1);
    // Accordion with one entry, opening all not required: viewed at once.
    expect(current()).toBe('Häufige Fragen');
    player.goTo(2);
    expect(current()).toBe('Gespräch mit Kollegin');
    // Linear navigation: the quiz stays locked until the dialog is finished.
    const quizItem = [...root.querySelectorAll<HTMLButtonElement>('.cc-outline-item')].find(
      (b) => b.textContent === 'Abschlusstest',
    );
    expect(quizItem?.disabled).toBe(true);
    player.destroy();
    root.remove();
  });
});
