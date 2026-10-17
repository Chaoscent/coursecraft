// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { slideNodeSchema } from '@coursecraft/course-model';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderSlide } from '../render/slide.js';
import { SlideTimeline } from './timeline.js';

const ctx = {
  lang: 'de',
  fallbackLang: 'de',
  assetUrl: (sha: string) => `assets/${sha}`,
  assetMime: () => 'audio/mp4',
  branding: { accent: '#1f5fa6', text: '#1d1f22', background: '#ffffff' },
};
const text = (id: string, startMs: number, endMs?: number) => ({
  id,
  name: id,
  type: 'text',
  frame: { x: 0, y: 0, width: 100, height: 40 },
  content: { de: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }] } },
  style: {},
  timing: { startMs, ...(endMs !== undefined ? { endMs } : {}) },
});
const slide = slideNodeSchema.parse({
  kind: 'slide',
  id: 's1',
  title: { de: 'Folie' },
  elements: [text('a', 0), text('b', 2000), text('c', 0, 3000)],
  durationMs: 6000,
});

/** Stand-in for an audio element: the test moves its position. */
function fakeAudio() {
  return {
    currentTime: 0,
    ended: false,
    duration: 4,
    paused: true,
    play: () => Promise.resolve(),
    pause: () => undefined,
  };
}

afterEach(() => vi.useRealTimers());

describe('SlideTimeline', () => {
  it('follows the narration position and does not run while the audio is paused', () => {
    vi.useFakeTimers();
    window.matchMedia = () => ({ matches: true }) as MediaQueryList;
    const rendered = renderSlide(slide, ctx, { width: 1280, height: 720 });
    const audio = fakeAudio();
    const timeline = new SlideTimeline(
      slide,
      rendered,
      audio as unknown as HTMLAudioElement,
      () => undefined,
    );
    timeline.start();
    const visible = (id: string) => !rendered.elements.get(id)?.hidden;
    expect([visible('a'), visible('b'), visible('c')]).toEqual([true, false, true]);

    // Autoplay blocked: wall time passes, the slide waits for the audio.
    vi.advanceTimersByTime(5000);
    expect(visible('b')).toBe(false);

    audio.currentTime = 2.5;
    vi.advanceTimersByTime(100);
    expect(visible('b')).toBe(true);

    audio.currentTime = 3.2;
    vi.advanceTimersByTime(100);
    expect(visible('c')).toBe(false);

    // After the audio ends, time runs on to the slide duration.
    audio.currentTime = 4;
    audio.ended = true;
    vi.advanceTimersByTime(100);
    expect(timeline.finished()).toBe(false);
    vi.advanceTimersByTime(2100);
    expect(timeline.finished()).toBe(true);
    timeline.stop();
  });
});
