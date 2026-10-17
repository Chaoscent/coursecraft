// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { interactionNodeSchema } from '@coursecraft/course-model';
import { describe, expect, it, vi } from 'vitest';
import type { NodeApi } from '../runtime/player.js';
import { stringsFor } from '../runtime/strings.js';
import { renderInteraction } from './interaction.js';

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
const entry = (id: string, title: string) => ({ id, title: { de: title }, body: doc(`Text ${title}`) });

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

const node = (content: unknown, requireAllViewed = false) =>
  interactionNodeSchema.parse({
    kind: 'interaction',
    id: 'ix',
    title: { de: 'Titel' },
    content,
    requireAllViewed,
  });

describe('interactions', () => {
  it('accordion counts as viewed only after every panel was opened', () => {
    const a = api();
    const root = renderInteraction(
      node({ variant: 'accordion', items: [entry('a', 'Eins'), entry('b', 'Zwei')] }, true),
      a,
    );
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.cc-ix-acc-button')];
    expect(buttons).toHaveLength(2);
    buttons[0]?.click();
    expect(buttons[0]?.getAttribute('aria-expanded')).toBe('true');
    expect(a.markViewed).not.toHaveBeenCalled();
    buttons[1]?.click();
    expect(a.markViewed).toHaveBeenCalledTimes(1);
    expect(a.allowNext).toHaveBeenCalled();
  });

  it('is viewed immediately when opening all is not required', () => {
    const a = api();
    renderInteraction(node({ variant: 'accordion', items: [entry('a', 'Eins')] }), a);
    expect(a.markViewed).toHaveBeenCalled();
  });

  it('tabs follow the arrow keys and roving tabindex', () => {
    const root = renderInteraction(
      node({ variant: 'tabs', items: [entry('a', 'Eins'), entry('b', 'Zwei'), entry('c', 'Drei')] }),
      api(),
    );
    document.body.append(root);
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const panels = [...root.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    tabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(tabs[2]?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[2]);
    expect(panels.map((p) => p.hidden)).toEqual([true, true, false]);
    root.remove();
  });

  it('steps disable the edges, cycles wrap around', () => {
    const items = [entry('a', 'Eins'), entry('b', 'Zwei')];
    const steps = renderInteraction(node({ variant: 'steps', items }), api());
    const [prev, next] = [...steps.querySelectorAll<HTMLButtonElement>('.cc-ix-step-nav button')];
    expect(prev?.disabled).toBe(true);
    next?.click();
    expect(steps.textContent).toContain('Schritt 2 von 2');
    expect(next?.disabled).toBe(true);
    const cycle = renderInteraction(node({ variant: 'cycle', items }), api());
    const [, forward] = [...cycle.querySelectorAll<HTMLButtonElement>('.cc-ix-step-nav button')];
    forward?.click();
    forward?.click();
    expect(cycle.querySelector('.cc-ix-step-status')?.textContent).toBe('Schritt 1 von 2');
  });

  it('glossary sorts and filters terms', () => {
    const root = renderInteraction(
      node({
        variant: 'glossary',
        terms: [
          { id: 'z', term: { de: 'Zertifikat' }, definition: doc('Nachweis') },
          { id: 'a', term: { de: 'Audit' }, definition: doc('Prüfung') },
        ],
      }),
      api(),
    );
    expect([...root.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Audit', 'Zertifikat']);
    const search = root.querySelector<HTMLInputElement>('input[type="search"]');
    if (!search) throw new Error('no search');
    search.value = 'zert';
    search.dispatchEvent(new Event('input'));
    expect([...root.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Zertifikat']);
    expect(root.textContent).toContain('1 Begriffe');
  });

  it('labeled graphic markers are positioned buttons that open their text', () => {
    const root = renderInteraction(
      node({
        variant: 'labeledGraphic',
        image: { image: { $asset: 'b'.repeat(64) }, altText: { de: 'Maschine' } },
        markers: [{ ...entry('m', 'Schalter'), position: { x: 0.25, y: 0.5 } }],
      }),
      api(),
    );
    const marker = root.querySelector<HTMLButtonElement>('.cc-ix-marker');
    expect(marker?.style.left).toBe('25%');
    expect(marker?.getAttribute('aria-label')).toBe('Schalter');
    marker?.click();
    expect(root.querySelector('.cc-ix-marker-panel')?.textContent).toContain('Text Schalter');
  });
});
