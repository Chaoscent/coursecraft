// SPDX-License-Identifier: Apache-2.0
import type { SlideElement, SlideNode } from '@coursecraft/course-model';
import { color, localized, type RenderContext } from './context.js';
import { h, svg } from './dom.js';
import { plainText, renderRichText } from './richtext.js';

type ElementOf<T extends SlideElement['type']> = Extract<SlideElement, { type: T }>;

export interface RenderedSlide {
  /** Canvas in logical pixels; scale it with a CSS transform. */
  root: HTMLElement;
  elements: Map<string, HTMLElement>;
  layers: Map<string, HTMLElement>;
  media: Map<string, HTMLMediaElement>;
}

export interface SlideRenderOptions {
  width: number;
  height: number;
  /** Editor mode: no interactivity, media without autoplay. */
  static?: boolean;
}

const FONTS = {
  sans: 'var(--cc-font-sans)',
  serif: 'var(--cc-font-serif)',
  mono: 'var(--cc-font-mono)',
} as const;

function place(el: HTMLElement, frame: SlideElement['frame'], origin = { x: 0, y: 0 }): void {
  el.style.left = `${frame.x - origin.x}px`;
  el.style.top = `${frame.y - origin.y}px`;
  el.style.width = `${frame.width}px`;
  el.style.height = `${frame.height}px`;
  if (frame.rotation) el.style.transform = `rotate(${frame.rotation}deg)`;
}

function textBox(
  content: ElementOf<'text'>['content'] | undefined,
  style: ElementOf<'text'>['style'] | undefined,
  ctx: RenderContext,
): HTMLElement {
  const box = h('div', { class: 'cc-text' });
  if (style) {
    box.style.fontFamily = FONTS[style.font];
    box.style.fontSize = `${style.sizePx}px`;
    box.style.lineHeight = String(style.lineHeight);
    box.style.padding = `${style.paddingPx}px`;
    const c = color(ctx, style.color);
    if (c) box.style.color = c;
    box.style.justifyContent =
      style.verticalAlign === 'middle'
        ? 'center'
        : style.verticalAlign === 'bottom'
          ? 'flex-end'
          : 'flex-start';
  }
  box.append(renderRichText(localized(ctx, content), ctx));
  return box;
}

function shapeSvg(el: ElementOf<'shape'>, ctx: RenderContext): SVGSVGElement {
  const { width: w, height: h2 } = el.frame;
  const strokeWidth = el.stroke?.widthPx ?? 0;
  const inset = strokeWidth / 2;
  const root = svg('svg', {
    viewBox: `0 0 ${w} ${h2}`,
    width: '100%',
    height: '100%',
    'aria-hidden': 'true',
    preserveAspectRatio: 'none',
  });
  const paint = {
    fill: color(ctx, el.fill) ?? 'none',
    stroke: color(ctx, el.stroke?.color) ?? 'none',
    'stroke-width': strokeWidth,
  };
  let shape: SVGElement;
  switch (el.shape) {
    case 'rectangle':
      shape = svg('rect', {
        x: inset,
        y: inset,
        width: Math.max(0, w - strokeWidth),
        height: Math.max(0, h2 - strokeWidth),
        ...paint,
      });
      break;
    case 'ellipse':
      shape = svg('ellipse', {
        cx: w / 2,
        cy: h2 / 2,
        rx: Math.max(0, w / 2 - inset),
        ry: Math.max(0, h2 / 2 - inset),
        ...paint,
      });
      break;
    case 'triangle':
      shape = svg('polygon', {
        points: `${w / 2},${inset} ${w - inset},${h2 - inset} ${inset},${h2 - inset}`,
        ...paint,
      });
      break;
    case 'line':
      shape = svg('line', {
        x1: 0,
        y1: h2 / 2,
        x2: w,
        y2: h2 / 2,
        ...paint,
        stroke: paint.stroke === 'none' ? '#1d1f22' : paint.stroke,
        'stroke-width': strokeWidth || 2,
      });
      break;
    case 'arrow': {
      const sw = strokeWidth || 2;
      const head = Math.min(h2, sw * 5);
      const stroke = paint.stroke === 'none' ? '#1d1f22' : paint.stroke;
      const group = svg('g');
      group.append(svg('line', { x1: 0, y1: h2 / 2, x2: w - head, y2: h2 / 2, stroke, 'stroke-width': sw }));
      group.append(
        svg('polygon', {
          points: `${w - head},${h2 / 2 - head / 2} ${w},${h2 / 2} ${w - head},${h2 / 2 + head / 2}`,
          fill: stroke,
        }),
      );
      shape = group;
      break;
    }
  }
  root.append(shape);
  return root;
}

function mediaSources(
  media: HTMLMediaElement,
  sources: Record<string, { $asset: string }>,
  captions: Record<string, { $asset: string }>,
  ctx: RenderContext,
  alternatives?: Record<string, { $asset: string }>,
): void {
  // The browser plays the first source it supports, so the alternative goes first.
  for (const source of [localized(ctx, alternatives), localized(ctx, sources)]) {
    if (!source) continue;
    const mime = ctx.assetMime(source.$asset);
    media.append(
      h('source', { attrs: { src: ctx.assetUrl(source.$asset), ...(mime ? { type: mime } : {}) } }),
    );
  }
  for (const [lang, track] of Object.entries(captions)) {
    media.append(
      h('track', {
        attrs: {
          kind: 'captions',
          srclang: lang,
          label: lang.toUpperCase(),
          src: ctx.assetUrl(track.$asset),
          ...(lang === ctx.lang ? { default: '' } : {}),
        },
      }),
    );
  }
}

function renderElement(
  el: SlideElement,
  ctx: RenderContext,
  out: RenderedSlide,
  options: SlideRenderOptions,
  origin = { x: 0, y: 0 },
): HTMLElement {
  const box = h('div', { class: `cc-el cc-el-${el.type}`, attrs: { 'data-id': el.id } });
  place(box, el.frame, origin);
  if (el.hidden) box.hidden = true;

  switch (el.type) {
    case 'text':
      box.append(textBox(el.content, el.style, ctx));
      break;
    case 'image': {
      const img = h('img', {
        attrs: {
          src: ctx.assetUrl(el.image.$asset),
          alt: el.decorative ? '' : (localized(ctx, el.altText) ?? ''),
          draggable: 'false',
        },
      });
      img.style.objectFit = el.fit;
      box.append(img);
      break;
    }
    case 'shape': {
      box.append(shapeSvg(el, ctx));
      if (el.content)
        box.append(
          textBox(
            el.content,
            el.textStyle ?? {
              font: 'sans',
              sizePx: 24,
              lineHeight: 1.3,
              color: 'theme:text',
              verticalAlign: 'middle',
              paddingPx: 8,
            },
            ctx,
          ),
        );
      if (!el.decorative && el.altText) {
        box.setAttribute('role', 'img');
        box.setAttribute('aria-label', localized(ctx, el.altText) ?? '');
      }
      break;
    }
    case 'video': {
      const video = h('video', {
        attrs: { playsinline: '', preload: 'metadata', 'aria-label': localized(ctx, el.title) ?? '' },
      });
      if (el.controls) video.controls = true;
      if (el.loop) video.loop = true;
      if (el.poster) video.poster = ctx.assetUrl(el.poster.$asset);
      if (el.autoplay && !options.static) video.dataset['autoplay'] = 'true';
      mediaSources(video, el.sources, el.captions, ctx, el.webmSources);
      box.append(video);
      out.media.set(el.id, video);
      break;
    }
    case 'audio': {
      const audio = h('audio', {
        attrs: { preload: 'metadata', 'aria-label': localized(ctx, el.title) ?? '' },
      });
      if (el.controls) audio.controls = true;
      if (el.loop) audio.loop = true;
      if (el.autoplay && !options.static) audio.dataset['autoplay'] = 'true';
      mediaSources(audio, el.sources, {}, ctx);
      box.append(audio);
      if (el.transcript) {
        box.append(
          h('details', { class: 'cc-transcript' }, [
            h('summary', { text: 'Transcript' }),
            h('div', {}, [renderRichText(localized(ctx, el.transcript), ctx)]),
          ]),
        );
      }
      out.media.set(el.id, audio);
      break;
    }
    case 'hotspot': {
      const button = h('button', {
        class: 'cc-hotspot',
        attrs: { type: 'button', 'aria-label': localized(ctx, el.label) ?? '' },
      });
      if (el.shape === 'ellipse') button.classList.add('cc-hotspot-ellipse');
      if (options.static) button.tabIndex = -1;
      box.append(button);
      break;
    }
    case 'group': {
      for (const child of el.children)
        box.append(renderElement(child, ctx, out, options, { x: el.frame.x, y: el.frame.y }));
      break;
    }
  }
  out.elements.set(el.id, box);
  return box;
}

/** Renders a slide into a fixed-size canvas. Pure DOM; no event handling. */
export function renderSlide(
  slide: SlideNode,
  ctx: RenderContext,
  options: SlideRenderOptions,
): RenderedSlide {
  const root = h('div', { class: 'cc-canvas', attrs: { 'data-slide': slide.id } });
  root.style.width = `${options.width}px`;
  root.style.height = `${options.height}px`;
  root.style.backgroundColor =
    color(ctx, slide.background.color) ?? color(ctx, ctx.branding.background) ?? '#ffffff';
  root.style.color = color(ctx, ctx.branding.text) ?? '#1d1f22';
  if (slide.useFallbackImage && slide.fallbackImage) {
    root.append(
      h('img', {
        class: 'cc-fallback',
        attrs: { src: ctx.assetUrl(slide.fallbackImage.$asset), alt: localized(ctx, slide.title) ?? '' },
      }),
    );
  } else if (slide.background.image) {
    root.style.backgroundImage = `url("${ctx.assetUrl(slide.background.image.$asset)}")`;
    root.style.backgroundSize = 'cover';
  }

  const out: RenderedSlide = { root, elements: new Map(), layers: new Map(), media: new Map() };
  if (!(slide.useFallbackImage && slide.fallbackImage)) {
    for (const el of slide.elements) root.append(renderElement(el, ctx, out, options));
  }
  for (const layer of slide.layers) {
    const layerEl = h('div', { class: 'cc-layer', attrs: { 'data-layer': layer.id } });
    layerEl.hidden = !layer.visibleInitially;
    for (const el of layer.elements) layerEl.append(renderElement(el, ctx, out, options));
    root.append(layerEl);
    out.layers.set(layer.id, layerEl);
  }
  return out;
}

/** Linear, reflowing alternative of a slide (WCAG 1.4.10 reflow). */
export function renderTextView(slide: SlideNode, ctx: RenderContext): HTMLElement {
  const article = h('article', { class: 'cc-textview' }, [
    h('h2', { text: localized(ctx, slide.title) ?? '' }),
  ]);
  const add = (elements: SlideElement[]) => {
    for (const el of [...elements].sort((a, b) => a.frame.y - b.frame.y || a.frame.x - b.frame.x)) {
      if (el.hidden) continue;
      switch (el.type) {
        case 'text': {
          const doc = localized(ctx, el.content);
          if (plainText(doc)) article.append(h('div', { class: 'cc-tv-text' }, [renderRichText(doc, ctx)]));
          break;
        }
        case 'image':
          if (!el.decorative) {
            article.append(
              h('figure', {}, [
                h('img', {
                  attrs: { src: ctx.assetUrl(el.image.$asset), alt: localized(ctx, el.altText) ?? '' },
                }),
              ]),
            );
          }
          break;
        case 'shape':
          if (el.content)
            article.append(
              h('div', { class: 'cc-tv-text' }, [renderRichText(localized(ctx, el.content), ctx)]),
            );
          break;
        case 'video':
        case 'audio': {
          const media = h(el.type, {
            attrs: { controls: '', preload: 'metadata', 'aria-label': localized(ctx, el.title) ?? '' },
          });
          if (el.type === 'video') mediaSources(media, el.sources, el.captions, ctx, el.webmSources);
          else mediaSources(media, el.sources, {}, ctx);
          article.append(media);
          break;
        }
        case 'group':
          add(el.children);
          break;
        case 'hotspot':
          break;
      }
    }
  };
  add(slide.elements);
  return article;
}
