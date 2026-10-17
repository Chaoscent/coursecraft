// SPDX-License-Identifier: Apache-2.0
import type { Course, CourseNode, SlideNode } from '@lernwerk/course-model';
import { localized, type RenderContext } from '../render/context.js';
import { h } from '../render/dom.js';
import { renderSlide, renderTextView, type RenderedSlide } from '../render/slide.js';
import { renderDialog } from '../dialog/dialog.js';
import { renderInteraction } from '../interactions/interaction.js';
import { renderQuiz, renderSurvey } from '../quiz/quiz.js';
import type { InteractionRecord, ResumeState, Tracker } from '../tracking/types.js';
import { stringsFor, type Strings } from './strings.js';
import { SlideTimeline } from './timeline.js';

type Action = SlideNode['elements'][number]['triggers'][number]['actions'][number];

export interface PlayerOptions {
  course: Course;
  tracker: Tracker;
  assetUrl: (sha256: string) => string;
  lang?: string;
  /** Renders another node kind; returns null if unsupported. Used for quizzes and interactions. */
  renderNode?: (node: CourseNode, api: NodeApi) => HTMLElement | null;
}

/** What node renderers (quiz, interactions) may do. */
export interface NodeApi {
  ctx: RenderContext;
  strings: Strings;
  markViewed(): void;
  /** Allows "next" in linear navigation (e.g. after answering). */
  allowNext(): void;
  next(): void;
  goTo(nodeId: string): void;
  finish(): void;
  reportScore(nodeId: string, score: { scaled: number; passed: boolean }): void;
}

interface Entry {
  node: CourseNode;
  chapterTitle: string;
}

const NARROW_PX = 600;

function flattenElements(slide: SlideNode) {
  type El = SlideNode['elements'][number];
  const all: El[] = [];
  const walk = (els: El[]) => {
    for (const el of els) {
      all.push(el);
      if (el.type === 'group') walk(el.children);
    }
  };
  walk(slide.elements);
  for (const layer of slide.layers) walk(layer.elements);
  return all;
}

/** Course player: navigation, outline, progress, rendering and tracking. */
export class Player {
  readonly #opts: PlayerOptions;
  readonly #ctx: RenderContext;
  readonly #strings: Strings;
  readonly #entries: Entry[];
  readonly #root: HTMLElement;
  readonly #stage: HTMLElement;
  readonly #outline: HTMLOListElement;
  readonly #counter: HTMLElement;
  readonly #progressBar: HTMLElement;
  readonly #prev: HTMLButtonElement;
  readonly #next: HTMLButtonElement;
  readonly #viewToggle: HTMLButtonElement;
  readonly #viewed = new Set<number>();
  readonly #nextAllowed = new Set<number>();
  readonly #scores = new Map<string, { scaled: number; passed: boolean }>();
  #index = 0;
  #textView = false;
  #current: { rendered?: RenderedSlide; timeline?: SlideTimeline; resize?: ResizeObserver } = {};
  #completed = false;

  constructor(container: HTMLElement, opts: PlayerOptions) {
    this.#opts = opts;
    const { course } = opts;
    const lang = opts.lang ?? course.languages.default;
    this.#ctx = {
      lang,
      fallbackLang: course.languages.default,
      assetUrl: opts.assetUrl,
      assetMime: (sha) => course.assets[sha]?.mime,
      branding: course.settings.branding,
    };
    this.#strings = stringsFor(lang);
    this.#entries = course.structure.chapters.flatMap((chapter) =>
      chapter.nodeIds.flatMap((id) => {
        const node = course.nodes[id];
        return node ? [{ node, chapterTitle: localized(this.#ctx, chapter.title) ?? '' }] : [];
      }),
    );

    const s = this.#strings;
    this.#outline = h('ol', { class: 'lw-outline-list' });
    this.#stage = h('main', { class: 'lw-stage', attrs: { tabindex: '-1' } });
    this.#counter = h('span', { class: 'lw-counter', attrs: { 'aria-live': 'polite' } });
    this.#progressBar = h('span', { class: 'lw-progress-fill' });
    this.#prev = h('button', { class: 'lw-button', attrs: { type: 'button' }, text: s.previous });
    this.#next = h('button', {
      class: 'lw-button lw-button-primary',
      attrs: { type: 'button' },
      text: s.next,
    });
    this.#viewToggle = h('button', {
      class: 'lw-button',
      attrs: { type: 'button', 'aria-pressed': 'false' },
      text: s.textView,
    });
    const outlineToggle = h('button', {
      class: 'lw-button',
      attrs: { type: 'button', 'aria-expanded': 'true', 'aria-controls': 'lw-outline' },
      text: s.outline,
    });
    const sidebar = course.settings.player.sidebar;
    const outline = h('nav', { class: 'lw-outline', attrs: { id: 'lw-outline', 'aria-label': s.outline } }, [
      this.#outline,
    ]);

    this.#root = h('div', { class: `lw-player lw-sidebar-${sidebar}`, attrs: { lang } }, [
      h('header', { class: 'lw-bar' }, [
        sidebar === 'none' ? null : outlineToggle,
        h('h1', { class: 'lw-title', text: localized(this.#ctx, course.meta.title) ?? '' }),
        course.settings.player.showProgress
          ? h(
              'span',
              {
                class: 'lw-progress',
                attrs: {
                  role: 'progressbar',
                  'aria-label': s.progress,
                  'aria-valuemin': '0',
                  'aria-valuemax': '100',
                },
              },
              [this.#progressBar],
            )
          : null,
        this.#viewToggle,
      ]),
      h('div', { class: 'lw-body' }, [sidebar === 'none' ? null : outline, this.#stage]),
      h('footer', { class: 'lw-nav' }, [this.#prev, this.#counter, this.#next]),
    ]);
    if (course.settings.branding.logo) {
      const logo = h('img', {
        class: 'lw-logo',
        attrs: { src: opts.assetUrl(course.settings.branding.logo.$asset), alt: '' },
      });
      this.#root.querySelector('.lw-bar')?.prepend(logo);
    }
    this.#root.style.setProperty('--lw-accent', this.#colorOr(course.settings.branding.accent, '#1f5fa6'));
    container.replaceChildren(this.#root);

    outlineToggle.addEventListener('click', () => {
      const open = outlineToggle.getAttribute('aria-expanded') !== 'true';
      outlineToggle.setAttribute('aria-expanded', String(open));
      outline.hidden = !open;
    });
    this.#prev.addEventListener('click', () => this.goTo(this.#index - 1));
    this.#next.addEventListener('click', () => this.goTo(this.#index + 1));
    this.#viewToggle.addEventListener('click', () => {
      this.#textView = !this.#textView;
      this.#show();
    });
    this.#root.ownerDocument.addEventListener('keydown', this.#onKey);
    window.addEventListener('pagehide', this.#onHide);

    this.#textView = container.clientWidth > 0 && container.clientWidth < NARROW_PX;
    if (this.#textView) {
      outline.hidden = true;
      outlineToggle.setAttribute('aria-expanded', 'false');
    }
    const begin = (resume: ResumeState | null) => {
      if (resume) {
        for (const i of resume.viewed) if (i >= 0 && i < this.#entries.length) this.#viewed.add(i);
        this.#index = Math.min(Math.max(0, resume.location), this.#entries.length - 1);
      }
      const exit = opts.tracker.exitUrl?.();
      if (exit && /^https?:\/\//i.test(exit)) {
        const button = h('button', {
          class: 'lw-button',
          attrs: { type: 'button' },
          text: this.#strings.exit,
        });
        button.addEventListener('click', () => {
          opts.tracker.finish();
          window.location.assign(exit);
        });
        this.#root.querySelector('.lw-bar')?.append(button);
      }
      this.#show();
    };
    const started = opts.tracker.start();
    if (started instanceof Promise) void started.catch(() => null).then(begin);
    else begin(started);
  }

  get index(): number {
    return this.#index;
  }

  /** Removes listeners and stops media (editor preview closes the player). */
  destroy(): void {
    this.#teardown();
    this.#root.ownerDocument.removeEventListener('keydown', this.#onKey);
    window.removeEventListener('pagehide', this.#onHide);
    this.#opts.tracker.finish();
  }

  readonly #onHide = () => this.#opts.tracker.finish();

  /** Arrow and page keys navigate unless a control (input, media) has focus. */
  readonly #onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (
      event.defaultPrevented ||
      target?.closest('input, textarea, select, [contenteditable], video, audio, [role="slider"]')
    )
      return;
    if (target && target !== target.ownerDocument.body && !this.#root.contains(target)) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') this.goTo(this.#index + 1);
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') this.goTo(this.#index - 1);
  };

  goTo(index: number): void {
    if (index < 0 || index >= this.#entries.length || index === this.#index) return;
    if (index > this.#index && !this.#canEnter(index)) return;
    this.#index = index;
    this.#show();
    this.#stage.focus({ preventScroll: true });
  }

  #canEnter(index: number): boolean {
    if (this.#opts.course.settings.navigation === 'free') return true;
    // Linear: every node before the target must be viewed (and released, for quizzes).
    for (let i = 0; i < index; i++) if (!this.#viewed.has(i) || this.#isGated(i)) return false;
    return true;
  }

  #isGated(i: number): boolean {
    const entry = this.#entries[i];
    return !!entry && entry.node.kind === 'quiz' && !this.#nextAllowed.has(i);
  }

  #colorOr(value: string, fallback: string): string {
    return value.startsWith('#') ? value : fallback;
  }

  #renderOutline(): void {
    this.#outline.replaceChildren();
    let chapter = '';
    let list: HTMLOListElement | null = null;
    this.#entries.forEach((entry, i) => {
      if (entry.chapterTitle !== chapter || !list) {
        chapter = entry.chapterTitle;
        list = h('ol');
        this.#outline.append(
          h('li', { class: 'lw-chapter' }, [h('span', { class: 'lw-chapter-title', text: chapter }), list]),
        );
      }
      const title = localized(this.#ctx, entry.node.title) ?? '';
      const button = h('button', { class: 'lw-outline-item', attrs: { type: 'button' }, text: title });
      if (i === this.#index) button.setAttribute('aria-current', 'step');
      if (this.#viewed.has(i)) button.classList.add('lw-viewed');
      if (i > this.#index && !this.#canEnter(i)) {
        button.disabled = true;
        button.title = this.#strings.locked;
      }
      button.addEventListener('click', () => this.goTo(i));
      list.append(h('li', {}, [button]));
    });
  }

  #teardown(): void {
    this.#current.timeline?.stop();
    this.#current.resize?.disconnect();
    for (const media of this.#current.rendered?.media.values() ?? []) media.pause();
    this.#current = {};
  }

  #show(): void {
    this.#teardown();
    const entry = this.#entries[this.#index];
    if (!entry) return;
    const { node } = entry;
    this.#viewToggle.setAttribute('aria-pressed', String(this.#textView));
    this.#viewToggle.textContent = this.#textView ? this.#strings.slideView : this.#strings.textView;
    this.#viewToggle.hidden = node.kind !== 'slide';

    const track = (record: InteractionRecord) => this.#opts.tracker.interaction(record);
    if (node.kind === 'slide') {
      if (this.#textView) this.#stage.replaceChildren(renderTextView(node, this.#ctx));
      else this.#showSlide(node);
      this.#opts.tracker.experienced(node.id, localized(this.#ctx, node.title) ?? '');
      this.#markViewed();
    } else if (node.kind === 'quiz') {
      this.#stage.replaceChildren(
        h('div', { class: 'lw-node-scroll' }, [renderQuiz(node, this.#nodeApi(), track)]),
      );
    } else if (node.kind === 'survey') {
      this.#stage.replaceChildren(
        h('div', { class: 'lw-node-scroll' }, [renderSurvey(node, this.#nodeApi(), track)]),
      );
    } else if (node.kind === 'interaction') {
      this.#stage.replaceChildren(
        h('div', { class: 'lw-node-scroll' }, [renderInteraction(node, this.#nodeApi())]),
      );
    } else if (node.kind === 'dialog') {
      this.#stage.replaceChildren(
        h('div', { class: 'lw-node-scroll' }, [renderDialog(node, this.#nodeApi(), track)]),
      );
    } else {
      const custom = this.#opts.renderNode?.(node, this.#nodeApi());
      if (custom) this.#stage.replaceChildren(custom);
      else {
        this.#stage.replaceChildren(h('p', { class: 'lw-unsupported', text: this.#strings.unsupported }));
        this.#markViewed();
        this.#nextAllowed.add(this.#index);
      }
    }
    document.title = localized(this.#ctx, node.title) ?? document.title;
    // Nodes that are not viewed on entry (quizzes, interactions, dialogs) still move the current marker.
    this.#renderOutline();
    this.#updateChrome();
  }

  #nodeApi(): NodeApi {
    const index = this.#index;
    return {
      ctx: this.#ctx,
      strings: this.#strings,
      markViewed: () => this.#markViewed(index),
      allowNext: () => {
        this.#nextAllowed.add(index);
        this.#updateChrome();
      },
      next: () => this.goTo(index + 1),
      goTo: (id) => this.#goToNode(id),
      finish: () => this.#complete(true),
      reportScore: (nodeId, score) => {
        this.#scores.set(nodeId, score);
        this.#checkCompletion();
      },
    };
  }

  #goToNode(id: string): void {
    const target = this.#entries.findIndex((e) => e.node.id === id);
    if (target >= 0) {
      this.#index = target;
      this.#show();
    }
  }

  #showSlide(slide: SlideNode): void {
    const { width, height } = this.#opts.course.settings.canvas;
    const rendered = renderSlide(slide, this.#ctx, { width, height });
    const frame = h('div', { class: 'lw-canvas-frame' }, [rendered.root]);
    let narration: HTMLAudioElement | null = null;
    const narrationSource = slide.narration ? localized(this.#ctx, slide.narration.sources) : undefined;
    let captionBox: HTMLElement | null = null;
    if (narrationSource) {
      narration = h('audio', {
        class: 'lw-narration',
        attrs: {
          controls: '',
          preload: 'auto',
          src: this.#opts.assetUrl(narrationSource.$asset),
          'aria-label': this.#strings.narration,
        },
      });
      const captions = slide.narration ? localized(this.#ctx, slide.narration.captions) : undefined;
      if (captions) {
        captionBox = h('div', { class: 'lw-captions', attrs: { 'aria-hidden': 'true' } });
        const track = h('track', {
          attrs: {
            kind: 'captions',
            src: this.#opts.assetUrl(captions.$asset),
            srclang: this.#ctx.lang,
            default: '',
          },
        });
        narration.append(track);
        const box = captionBox;
        track.track.mode = 'hidden';
        track.addEventListener('cuechange', () => {
          const cues = Array.from(track.track.activeCues ?? []) as VTTCue[];
          box.textContent = cues.map((c) => c.text.replace(/<[^>]*>/g, '')).join('\n');
        });
      }
    }
    this.#stage.replaceChildren(
      frame,
      ...(captionBox ? [captionBox] : []),
      ...(narration ? [narration] : []),
    );

    const fit = () => {
      const available = this.#stage.clientWidth - 16;
      const availableHeight = this.#stage.clientHeight - (narration ? 56 : 16) - (captionBox ? 48 : 0);
      const scale = Math.max(0.1, Math.min(available / width, availableHeight / height));
      rendered.root.style.transform = `scale(${scale})`;
      frame.style.width = `${width * scale}px`;
      frame.style.height = `${height * scale}px`;
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(this.#stage);

    for (const el of flattenElements(slide)) {
      const node = rendered.elements.get(el.id);
      if (!node) continue;
      const clicks = el.triggers.filter((t) => t.event.type === 'click');
      if (clicks.length) {
        const target = el.type === 'hotspot' ? node.querySelector('button') : node;
        if (target && el.type !== 'hotspot') {
          target.setAttribute('role', 'button');
          target.tabIndex = 0;
          target.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              for (const t of clicks) this.#run(t.actions, rendered);
            }
          });
        }
        target?.addEventListener('click', () => {
          for (const t of clicks) this.#run(t.actions, rendered);
        });
      }
      const ended = el.triggers.filter((t) => t.event.type === 'mediaEnded');
      const media = rendered.media.get(el.id);
      if (media && ended.length)
        media.addEventListener('ended', () => ended.forEach((t) => this.#run(t.actions, rendered)));
      if (media?.dataset['autoplay'] === 'true') void media.play().catch(() => undefined);
    }

    const timeline = new SlideTimeline(slide, rendered, narration, (elementId, atMs) => {
      const el = flattenElements(slide).find((e) => e.id === elementId);
      for (const t of el?.triggers ?? [])
        if (t.event.type === 'timeline' && t.event.atMs === atMs) this.#run(t.actions, rendered);
    });
    timeline.start();
    if (slide.advance === 'afterTimeline' && slide.durationMs) {
      const index = this.#index;
      const check = window.setInterval(() => {
        if (this.#index !== index) return window.clearInterval(check);
        if (timeline.finished()) {
          window.clearInterval(check);
          this.goTo(index + 1);
        }
      }, 200);
    }
    this.#current = { rendered, timeline, resize };
  }

  #run(actions: Action[], rendered: RenderedSlide): void {
    for (const action of actions) {
      switch (action.type) {
        case 'showElement':
        case 'hideElement':
        case 'toggleElement': {
          const el = rendered.elements.get(action.elementId);
          if (el)
            el.hidden =
              action.type === 'hideElement' ? true : action.type === 'showElement' ? false : !el.hidden;
          break;
        }
        case 'showLayer':
        case 'hideLayer': {
          const layer = rendered.layers.get(action.layerId);
          if (layer) layer.hidden = action.type === 'hideLayer';
          break;
        }
        case 'playMedia':
          void rendered.media
            .get(action.elementId)
            ?.play()
            .catch(() => undefined);
          break;
        case 'pauseMedia':
          rendered.media.get(action.elementId)?.pause();
          break;
        case 'seekTimeline':
          this.#current.timeline?.seek(action.atMs);
          break;
        case 'navigate':
          if (action.target.type === 'next') this.goTo(this.#index + 1);
          else if (action.target.type === 'previous') this.goTo(this.#index - 1);
          else if (action.target.type === 'node') this.#goToNode(action.target.nodeId);
          else this.#complete(true);
          break;
        case 'openLink':
          window.open(action.href, '_blank', 'noopener,noreferrer');
          break;
      }
    }
  }

  #markViewed(index = this.#index): void {
    this.#viewed.add(index);
    this.#opts.tracker.save(
      { location: this.#index, viewed: [...this.#viewed].sort((a, b) => a - b) },
      this.#progress(),
    );
    this.#checkCompletion();
    this.#renderOutline();
  }

  #progress(): number {
    return this.#entries.length ? this.#viewed.size / this.#entries.length : 0;
  }

  #checkCompletion(): void {
    if (this.#completed) return;
    const rule = this.#opts.course.settings.completion;
    if (rule.type === 'viewedPercent' && this.#progress() * 100 >= rule.percent) this.#complete(false);
    if (rule.type === 'quizPassed') {
      const score = this.#scores.get(rule.quizId);
      if (score) {
        this.#completed = true;
        this.#opts.tracker.complete({ completed: true, score: score.scaled, passed: score.passed });
      }
    }
  }

  #complete(explicit: boolean): void {
    if (this.#completed) return;
    const rule = this.#opts.course.settings.completion;
    if (rule.type === 'quizPassed' && !explicit) return;
    this.#completed = true;
    this.#opts.tracker.complete({ completed: true });
  }

  #updateChrome(): void {
    const total = this.#entries.length;
    this.#counter.textContent = `${this.#index + 1} ${this.#strings.of} ${total}`;
    this.#prev.disabled = this.#index === 0;
    this.#next.disabled = this.#index >= total - 1 || !this.#canEnter(this.#index + 1);
    const percent = Math.round(this.#progress() * 100);
    this.#progressBar.style.width = `${percent}%`;
    this.#progressBar.parentElement?.setAttribute('aria-valuenow', String(percent));
  }
}
