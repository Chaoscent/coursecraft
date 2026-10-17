// SPDX-License-Identifier: Apache-2.0
import type { SlideElement, SlideNode } from '@coursecraft/course-model';
import type { RenderedSlide } from '../render/slide.js';

type Animation = NonNullable<SlideElement['entrance']>;

function flatten(elements: SlideElement[]): SlideElement[] {
  return elements.flatMap((el) => (el.type === 'group' ? [el, ...flatten(el.children)] : [el]));
}

function animate(el: HTMLElement, animation: Animation | undefined, phase: 'in' | 'out'): void {
  if (!animation || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.style.animationDuration = `${animation.durationMs}ms`;
  el.classList.remove('cc-anim-in', 'cc-anim-out');
  el.dataset['effect'] = animation.effect;
  el.dataset['direction'] = animation.direction ?? 'left';
  // Restart the CSS animation.
  void el.offsetWidth;
  el.classList.add(phase === 'in' ? 'cc-anim-in' : 'cc-anim-out');
}

/**
 * Drives element timing, entrance/exit animations and timeline triggers.
 * The clock follows the narration when present, otherwise wall time.
 */
export class SlideTimeline {
  readonly #slide: SlideNode;
  readonly #rendered: RenderedSlide;
  readonly #onTrigger: (elementId: string, atMs: number) => void;
  readonly #narration: HTMLAudioElement | null;
  #start = performance.now();
  #timer: number | null = null;
  #lastMs = -1;
  #endedAt: number | null = null;

  constructor(
    slide: SlideNode,
    rendered: RenderedSlide,
    narration: HTMLAudioElement | null,
    onTrigger: (elementId: string, atMs: number) => void,
  ) {
    this.#slide = slide;
    this.#rendered = rendered;
    this.#narration = narration;
    this.#onTrigger = onTrigger;
  }

  get durationMs(): number {
    return this.#slide.durationMs ?? 0;
  }

  start(): void {
    for (const el of flatten([...this.#slide.elements, ...this.#slide.layers.flatMap((l) => l.elements)])) {
      const node = this.#rendered.elements.get(el.id);
      if (node && el.timing.startMs > 0) node.hidden = true;
    }
    this.#start = performance.now();
    void this.#narration?.play().catch(() => undefined);
    this.#tick();
    this.#timer = window.setInterval(() => this.#tick(), 100);
  }

  stop(): void {
    if (this.#timer !== null) window.clearInterval(this.#timer);
    this.#timer = null;
    this.#narration?.pause();
  }

  /**
   * With narration the clock is the audio position: nothing advances while
   * the audio is paused or blocked by autoplay rules. After the audio ends,
   * wall time continues up to the slide duration.
   */
  now(): number {
    const audio = this.#narration;
    if (!audio) return performance.now() - this.#start;
    if (audio.ended) {
      this.#endedAt ??= performance.now();
      return (
        (Number.isFinite(audio.duration) ? audio.duration * 1000 : 0) + performance.now() - this.#endedAt
      );
    }
    this.#endedAt = null;
    return audio.currentTime * 1000;
  }

  seek(ms: number): void {
    if (this.#narration) this.#narration.currentTime = ms / 1000;
    this.#start = performance.now() - ms;
    this.#lastMs = ms - 1;
  }

  /** True once the slide's timeline has run to its end. */
  finished(): boolean {
    return this.durationMs > 0 && this.now() >= this.durationMs;
  }

  #tick(): void {
    const ms = this.now();
    const from = this.#lastMs;
    this.#lastMs = ms;
    for (const el of flatten([...this.#slide.elements, ...this.#slide.layers.flatMap((l) => l.elements)])) {
      const node = this.#rendered.elements.get(el.id);
      if (!node || el.hidden) continue;
      const { startMs, endMs } = el.timing;
      if (startMs > from && startMs <= ms) {
        node.hidden = false;
        animate(node, el.entrance, 'in');
      } else if (from < 0 && startMs === 0) {
        animate(node, el.entrance, 'in');
      }
      if (endMs !== undefined && endMs > from && endMs <= ms) {
        if (el.exit) {
          animate(node, el.exit, 'out');
          window.setTimeout(() => (node.hidden = true), el.exit.durationMs);
        } else {
          node.hidden = true;
        }
      }
      for (const trigger of el.triggers) {
        if (trigger.event.type === 'timeline' && trigger.event.atMs > from && trigger.event.atMs <= ms)
          this.#onTrigger(el.id, trigger.event.atMs);
      }
    }
  }
}
