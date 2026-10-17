// SPDX-License-Identifier: Apache-2.0
import type { InteractionNode } from '@coursecraft/course-model';
import { h } from '../render/dom.js';
import { localized, type RenderContext } from '../render/context.js';
import { renderRichText } from '../render/richtext.js';
import type { NodeApi } from '../runtime/player.js';

type Content = InteractionNode['content'];
type Entry = Extract<Content, { variant: 'accordion' }>['items'][number];

let counter = 0;
const uid = (prefix: string) => `${prefix}-${++counter}`;

/** Tracks which items were opened; the node counts as viewed when all were (if required). */
function viewTracker(node: InteractionNode, api: NodeApi, ids: string[]) {
  const seen = new Set<string>();
  const done = () => {
    api.markViewed();
    api.allowNext();
  };
  if (!node.requireAllViewed) done();
  return (id: string) => {
    seen.add(id);
    if (node.requireAllViewed && ids.every((i) => seen.has(i))) done();
  };
}

function entryBody(entry: Entry, ctx: RenderContext): Node[] {
  const parts: Node[] = [];
  if (entry.media)
    parts.push(
      h('img', {
        class: 'cc-ix-media',
        attrs: {
          src: ctx.assetUrl(entry.media.image.$asset),
          alt: localized(ctx, entry.media.altText) ?? '',
        },
      }),
    );
  parts.push(h('div', { class: 'cc-ix-body' }, [renderRichText(localized(ctx, entry.body), ctx)]));
  return parts;
}

function accordion(items: Entry[], api: NodeApi, seen: (id: string) => void): HTMLElement {
  const { ctx } = api;
  return h(
    'div',
    { class: 'cc-ix-accordion' },
    items.map((item) => {
      const panelId = uid('cc-acc');
      const button = h('button', {
        class: 'cc-ix-acc-button',
        attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': panelId },
        text: localized(ctx, item.title) ?? '',
      });
      const panel = h(
        'div',
        { class: 'cc-ix-acc-panel', attrs: { id: panelId, role: 'region' } },
        entryBody(item, ctx),
      );
      panel.setAttribute('aria-label', localized(ctx, item.title) ?? '');
      panel.hidden = true;
      button.addEventListener('click', () => {
        const open = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', String(open));
        panel.hidden = !open;
        if (open) seen(item.id);
      });
      return h('div', { class: 'cc-ix-acc-item' }, [
        h('h3', { class: 'cc-ix-acc-heading' }, [button]),
        panel,
      ]);
    }),
  );
}

/** WAI-ARIA tabs: arrow keys move between tabs, the panel follows. */
function tabs(items: Entry[], api: NodeApi, seen: (id: string) => void): HTMLElement {
  const { ctx } = api;
  const list = h('div', { class: 'cc-ix-tablist', attrs: { role: 'tablist' } });
  const panels: HTMLElement[] = [];
  const buttons: HTMLButtonElement[] = [];
  const select = (index: number, focus: boolean) => {
    buttons.forEach((b, i) => {
      b.setAttribute('aria-selected', String(i === index));
      b.tabIndex = i === index ? 0 : -1;
      const panel = panels[i];
      if (panel) panel.hidden = i !== index;
    });
    if (focus) buttons[index]?.focus();
    const item = items[index];
    if (item) seen(item.id);
  };
  items.forEach((item, i) => {
    const tabId = uid('cc-tab');
    const panelId = uid('cc-tabpanel');
    const button = h('button', {
      class: 'cc-ix-tab',
      attrs: { type: 'button', role: 'tab', id: tabId, 'aria-controls': panelId },
      text: localized(ctx, item.title) ?? '',
    });
    button.addEventListener('click', () => select(i, false));
    button.addEventListener('keydown', (e) => {
      const last = items.length - 1;
      const next =
        e.key === 'ArrowRight'
          ? i === last
            ? 0
            : i + 1
          : e.key === 'ArrowLeft'
            ? i === 0
              ? last
              : i - 1
            : e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? last
                : -1;
      if (next >= 0) {
        e.preventDefault();
        select(next, true);
      }
    });
    buttons.push(button);
    list.append(button);
    panels.push(
      h(
        'div',
        {
          class: 'cc-ix-tabpanel',
          attrs: { role: 'tabpanel', id: panelId, 'aria-labelledby': tabId, tabindex: '0' },
        },
        entryBody(item, ctx),
      ),
    );
  });
  const root = h('div', { class: 'cc-ix-tabs' }, [list, ...panels]);
  select(0, false);
  return root;
}

/** One item at a time with previous/next; `cycle` wraps around and shows the ring. */
function stepper(items: Entry[], api: NodeApi, seen: (id: string) => void, cycle: boolean): HTMLElement {
  const { ctx, strings } = api;
  let index = 0;
  const status = h('p', { class: 'cc-ix-step-status', attrs: { 'aria-live': 'polite' } });
  const panel = h('div', { class: 'cc-ix-step-panel' });
  const prev = h('button', { class: 'cc-button', attrs: { type: 'button' }, text: strings.previous });
  const next = h('button', {
    class: 'cc-button cc-button-primary',
    attrs: { type: 'button' },
    text: strings.next,
  });
  const ring = cycle
    ? h(
        'ol',
        { class: 'cc-ix-cycle', attrs: { 'aria-label': strings.overview } },
        items.map((item, i) => {
          const angle = (i / items.length) * 2 * Math.PI - Math.PI / 2;
          const b = h('button', {
            class: 'cc-ix-cycle-item',
            attrs: { type: 'button' },
            text: localized(ctx, item.title) ?? '',
          });
          b.addEventListener('click', () => {
            index = i;
            render();
          });
          const li = h('li', {}, [b]);
          li.style.left = `${50 + Math.cos(angle) * 38}%`;
          li.style.top = `${50 + Math.sin(angle) * 38}%`;
          return li;
        }),
      )
    : null;
  const render = () => {
    const item = items[index];
    if (!item) return;
    panel.replaceChildren(
      h('h3', { class: 'cc-ix-step-title', text: localized(ctx, item.title) ?? '' }),
      ...entryBody(item, ctx),
    );
    status.textContent = strings.stepOf
      .replace('{n}', String(index + 1))
      .replace('{total}', String(items.length));
    prev.disabled = !cycle && index === 0;
    next.disabled = !cycle && index === items.length - 1;
    ring
      ?.querySelectorAll('button')
      .forEach((b, i) => b.setAttribute('aria-current', i === index ? 'step' : 'false'));
    seen(item.id);
  };
  prev.addEventListener('click', () => {
    index = index === 0 ? items.length - 1 : index - 1;
    render();
  });
  next.addEventListener('click', () => {
    index = index === items.length - 1 ? 0 : index + 1;
    render();
  });
  render();
  return h('div', { class: cycle ? 'cc-ix-steps cc-ix-has-cycle' : 'cc-ix-steps' }, [
    ...(ring ? [ring] : []),
    status,
    panel,
    h('div', { class: 'cc-ix-step-nav' }, [prev, next]),
  ]);
}

function timeline(
  events: Extract<Content, { variant: 'timeline' }>['events'],
  api: NodeApi,
  seen: (id: string) => void,
): HTMLElement {
  const { ctx } = api;
  return h(
    'ol',
    { class: 'cc-ix-timeline' },
    events.map((event) => {
      const panelId = uid('cc-tl');
      const button = h(
        'button',
        {
          class: 'cc-ix-tl-button',
          attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': panelId },
        },
        [
          h('span', { class: 'cc-ix-tl-date', text: localized(ctx, event.dateLabel) ?? '' }),
          h('span', { class: 'cc-ix-tl-title', text: localized(ctx, event.title) ?? '' }),
        ],
      );
      const panel = h('div', { class: 'cc-ix-tl-panel', attrs: { id: panelId } }, entryBody(event, ctx));
      panel.hidden = true;
      button.addEventListener('click', () => {
        const open = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', String(open));
        panel.hidden = !open;
        if (open) seen(event.id);
      });
      return h('li', { class: 'cc-ix-tl-event' }, [button, panel]);
    }),
  );
}

function glossary(terms: Extract<Content, { variant: 'glossary' }>['terms'], api: NodeApi): HTMLElement {
  const { ctx, strings } = api;
  const sorted = [...terms].sort((a, b) =>
    (localized(ctx, a.term) ?? '').localeCompare(localized(ctx, b.term) ?? '', ctx.lang),
  );
  const search = h('input', {
    class: 'cc-ix-search',
    attrs: { type: 'search', 'aria-label': strings.searchGlossary },
  });
  const count = h('p', { class: 'cc-ix-count', attrs: { 'aria-live': 'polite' } });
  const list = h('dl', { class: 'cc-ix-glossary' });
  const rows = sorted.map((term) => ({
    text: (localized(ctx, term.term) ?? '').toLocaleLowerCase(),
    nodes: [
      h('dt', { text: localized(ctx, term.term) ?? '' }),
      h('dd', {}, [renderRichText(localized(ctx, term.definition), ctx)]),
    ],
  }));
  const filter = () => {
    const q = search.value.trim().toLocaleLowerCase();
    const visible = rows.filter((r) => !q || r.text.includes(q));
    list.replaceChildren(...visible.flatMap((r) => r.nodes));
    count.textContent = strings.termsFound.replace('{n}', String(visible.length));
  };
  search.addEventListener('input', filter);
  filter();
  return h('div', { class: 'cc-ix-glossary-wrap' }, [search, count, list]);
}

/** Image with numbered markers; every marker is also a button in a list (keyboard, screen readers). */
function labeledGraphic(
  content: Extract<Content, { variant: 'labeledGraphic' }>,
  api: NodeApi,
  seen: (id: string) => void,
): HTMLElement {
  const { ctx } = api;
  const panel = h('div', { class: 'cc-ix-marker-panel', attrs: { 'aria-live': 'polite' } });
  const show = (marker: (typeof content.markers)[number], button: HTMLElement) => {
    figure.querySelectorAll('[aria-pressed]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    button.setAttribute('aria-pressed', 'true');
    panel.replaceChildren(h('h3', { text: localized(ctx, marker.title) ?? '' }), ...entryBody(marker, ctx));
    seen(marker.id);
  };
  const figure = h('div', { class: 'cc-ix-graphic' }, [
    h('img', {
      attrs: {
        src: ctx.assetUrl(content.image.image.$asset),
        alt: localized(ctx, content.image.altText) ?? '',
      },
    }),
  ]);
  content.markers.forEach((marker, i) => {
    const b = h('button', {
      class: 'cc-ix-marker',
      attrs: { type: 'button', 'aria-pressed': 'false', 'aria-label': localized(ctx, marker.title) ?? '' },
      text: String(i + 1),
    });
    b.style.left = `${marker.position.x * 100}%`;
    b.style.top = `${marker.position.y * 100}%`;
    b.addEventListener('click', () => show(marker, b));
    figure.append(b);
  });
  return h('div', { class: 'cc-ix-labeled' }, [figure, panel]);
}

export function renderInteraction(node: InteractionNode, api: NodeApi): HTMLElement {
  const { ctx } = api;
  const content = node.content;
  const ids =
    content.variant === 'glossary'
      ? []
      : content.variant === 'timeline'
        ? content.events.map((e) => e.id)
        : content.variant === 'labeledGraphic'
          ? content.markers.map((m) => m.id)
          : content.items.map((i) => i.id);
  const seen = viewTracker(
    content.variant === 'glossary' ? { ...node, requireAllViewed: false } : node,
    api,
    ids,
  );
  let body: HTMLElement;
  switch (content.variant) {
    case 'accordion':
      body = accordion(content.items, api, seen);
      break;
    case 'tabs':
      body = tabs(content.items, api, seen);
      break;
    case 'steps':
      body = stepper(content.items, api, seen, false);
      break;
    case 'cycle':
      body = stepper(content.items, api, seen, true);
      break;
    case 'timeline':
      body = timeline(content.events, api, seen);
      break;
    case 'glossary':
      body = glossary(content.terms, api);
      break;
    case 'labeledGraphic':
      body = labeledGraphic(content, api, seen);
      break;
  }
  const intro = node.intro ? localized(ctx, node.intro) : undefined;
  return h(
    'section',
    { class: `cc-ix cc-ix-${content.variant}`, attrs: { 'aria-label': localized(ctx, node.title) ?? '' } },
    [
      h('h2', { class: 'cc-ix-title', text: localized(ctx, node.title) ?? '' }),
      ...(intro ? [h('div', { class: 'cc-ix-intro' }, [renderRichText(intro, ctx)])] : []),
      body,
      ...(node.requireAllViewed ? [h('p', { class: 'cc-ix-hint', text: api.strings.openAll })] : []),
    ],
  );
}
