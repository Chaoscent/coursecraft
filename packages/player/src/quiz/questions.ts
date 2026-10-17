// SPDX-License-Identifier: Apache-2.0
import type { Question } from '@lernwerk/course-model';
import { shuffle, type Response } from '@lernwerk/course-model/scoring';
import { localized, type RenderContext } from '../render/context.js';
import { h } from '../render/dom.js';
import { renderRichText } from '../render/richtext.js';
import type { Strings } from '../runtime/strings.js';

export interface QuestionView {
  root: HTMLElement;
  response(): Response;
  /** True when the learner has given some answer. */
  answered(): boolean;
  disable(): void;
  enable(): void;
  /** Review: show correct answers next to the learner's. */
  reveal(): void;
}

let uid = 0;
const nextId = (prefix: string) => `lw-${prefix}-${++uid}`;

function legend(question: Question, ctx: RenderContext): HTMLElement {
  return h('legend', { class: 'lw-q-prompt' }, [renderRichText(localized(ctx, question.prompt), ctx)]);
}

function media(question: Question, ctx: RenderContext): HTMLElement | null {
  if (!('media' in question) || !question.media) return null;
  return h('img', {
    class: 'lw-q-media',
    attrs: {
      src: ctx.assetUrl(question.media.image.$asset),
      alt: localized(ctx, question.media.altText) ?? '',
    },
  });
}

function disableAll(root: HTMLElement, disabled: boolean): void {
  for (const el of root.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLButtonElement | HTMLTextAreaElement
  >('input, select, button, textarea')) {
    el.disabled = disabled;
  }
}

/** Splits a template like "Der {{a}} ist {{b}}." into text and blank ids. */
export function templateParts(template: string): ({ text: string } | { blank: string })[] {
  const parts: ({ text: string } | { blank: string })[] = [];
  let last = 0;
  for (const match of template.matchAll(/\{\{([A-Za-z0-9_-]+)\}\}/g)) {
    if (match.index > last) parts.push({ text: template.slice(last, match.index) });
    parts.push({ blank: match[1] ?? '' });
    last = match.index + match[0].length;
  }
  if (last < template.length) parts.push({ text: template.slice(last) });
  return parts;
}

function option(value: string, label: string): HTMLOptionElement {
  const o = h('option', { text: label });
  o.value = value;
  return o;
}

function choiceList(
  question: Extract<Question, { type: 'singleChoice' | 'multipleChoice' }>,
  ctx: RenderContext,
  random: () => number,
  multiple: boolean,
) {
  const name = nextId('c');
  const choices = question.shuffle ? shuffle(question.choices, random) : question.choices;
  const inputs = new Map<string, HTMLInputElement>();
  const items = choices.map((choice) => {
    const input = h('input', { attrs: { type: multiple ? 'checkbox' : 'radio', name, value: choice.id } });
    inputs.set(choice.id, input);
    return h('label', { class: 'lw-choice', attrs: { 'data-choice': choice.id } }, [
      input,
      h('span', { text: localized(ctx, choice.text) ?? '' }),
    ]);
  });
  return { list: h('div', { class: 'lw-choices' }, items), inputs, choices };
}

function markChoices(root: HTMLElement, correctIds: string[]): void {
  for (const label of root.querySelectorAll<HTMLElement>('[data-choice]')) {
    const correct = correctIds.includes(label.dataset['choice'] ?? '');
    label.classList.add(correct ? 'lw-is-correct' : 'lw-is-other');
  }
}

export function renderQuestion(
  question: Question,
  ctx: RenderContext,
  s: Strings,
  random: () => number,
): QuestionView {
  const fieldset = h('fieldset', { class: `lw-question lw-q-${question.type}` }, [
    legend(question, ctx),
    media(question, ctx),
  ]);
  const view = (response: () => Response, answered: () => boolean, reveal: () => void): QuestionView => ({
    root: fieldset,
    response,
    answered,
    disable: () => disableAll(fieldset, true),
    enable: () => disableAll(fieldset, false),
    reveal,
  });

  switch (question.type) {
    case 'singleChoice':
    case 'multipleChoice': {
      const multiple = question.type === 'multipleChoice';
      const { list, inputs } = choiceList(question, ctx, random, multiple);
      fieldset.append(list);
      const selected = () => [...inputs].filter(([, i]) => i.checked).map(([id]) => id);
      return view(
        () =>
          multiple
            ? { type: 'multipleChoice', choiceIds: selected() }
            : { type: 'singleChoice', choiceId: selected()[0] ?? null },
        () => selected().length > 0,
        () =>
          markChoices(
            fieldset,
            question.choices.filter((c) => c.correct).map((c) => c.id),
          ),
      );
    }
    case 'trueFalse': {
      const name = nextId('tf');
      const yes = h('input', { attrs: { type: 'radio', name, value: 'true' } });
      const no = h('input', { attrs: { type: 'radio', name, value: 'false' } });
      fieldset.append(
        h('div', { class: 'lw-choices' }, [
          h('label', { class: 'lw-choice', attrs: { 'data-choice': 'true' } }, [
            yes,
            h('span', { text: s.true }),
          ]),
          h('label', { class: 'lw-choice', attrs: { 'data-choice': 'false' } }, [
            no,
            h('span', { text: s.false }),
          ]),
        ]),
      );
      return view(
        () => ({ type: 'trueFalse', value: yes.checked ? true : no.checked ? false : null }),
        () => yes.checked || no.checked,
        () => markChoices(fieldset, [String(question.correct)]),
      );
    }
    case 'shortAnswer':
    case 'numeric': {
      const id = nextId('in');
      const input = h('input', {
        class: 'lw-input',
        attrs: {
          id,
          type: 'text',
          autocomplete: 'off',
          ...(question.type === 'numeric' ? { inputmode: 'decimal' } : {}),
        },
      });
      fieldset.append(
        h('label', { class: 'lw-field', attrs: { for: id } }, [h('span', { text: s.answer })]),
        input,
      );
      const solution =
        question.type === 'shortAnswer'
          ? (localized(ctx, question.accepted) ?? []).join(' / ')
          : question.accepted
              .map((a) => (a.type === 'exact' ? String(a.value) : `${a.min} – ${a.max}`))
              .join(' / ');
      return view(
        () =>
          question.type === 'numeric'
            ? {
                type: 'numeric',
                value: input.value.trim() === '' ? null : Number(input.value.replace(',', '.')),
              }
            : { type: 'shortAnswer', text: input.value },
        () => input.value.trim() !== '',
        () => fieldset.append(h('p', { class: 'lw-solution', text: `${s.correctAnswer}: ${solution}` })),
      );
    }
    case 'essay': {
      const id = nextId('es');
      const area = h('textarea', {
        class: 'lw-input lw-essay',
        attrs: { id, rows: '8', maxlength: String(question.maxLength) },
      });
      const counter = h('span', {
        class: 'lw-counter',
        attrs: { 'aria-live': 'polite' },
        text: `0 / ${question.maxLength} ${s.characters}`,
      });
      area.addEventListener(
        'input',
        () => (counter.textContent = `${area.value.length} / ${question.maxLength} ${s.characters}`),
      );
      fieldset.append(
        h('label', { class: 'lw-field', attrs: { for: id } }, [h('span', { text: s.answer })]),
        area,
        counter,
      );
      return view(
        () => ({ type: 'essay', text: area.value }),
        () => area.value.trim() !== '',
        () => undefined,
      );
    }
    case 'fillInBlanks':
    case 'selectBlanks':
    case 'wordBank': {
      const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
      const line = h('p', { class: 'lw-cloze' });
      let n = 0;
      const words = question.type === 'wordBank' ? shuffle(question.words, random) : [];
      for (const part of templateParts(localized(ctx, question.template) ?? '')) {
        if ('text' in part) {
          line.append(document.createTextNode(part.text));
          continue;
        }
        n += 1;
        const label = `${s.blank} ${n}`;
        let control: HTMLInputElement | HTMLSelectElement;
        if (question.type === 'fillInBlanks') {
          control = h('input', {
            class: 'lw-input lw-blank',
            attrs: { type: 'text', autocomplete: 'off', 'aria-label': label },
          });
        } else {
          control = h('select', { class: 'lw-input lw-blank', attrs: { 'aria-label': label } }, [
            option('', s.choose),
          ]);
          if (question.type === 'selectBlanks') {
            const blank = question.blanks.find((b) => b.id === part.blank);
            for (const o of blank ? shuffle(blank.options, random) : [])
              control.append(option(o.id, localized(ctx, o.text) ?? ''));
          } else {
            for (const w of words) control.append(option(w.id, localized(ctx, w.text) ?? ''));
          }
        }
        control.dataset['blank'] = part.blank;
        inputs.set(part.blank, control);
        line.append(control);
      }
      if (question.type === 'wordBank') {
        fieldset.append(
          h(
            'div',
            { class: 'lw-wordbank', attrs: { role: 'note', 'aria-label': s.wordBank } },
            words.map((w) => h('span', { class: 'lw-word', text: localized(ctx, w.text) ?? '' })),
          ),
        );
      }
      fieldset.append(line);
      const values = () => Object.fromEntries([...inputs].map(([id, el]) => [id, el.value]));
      return view(
        () => ({ type: question.type, blanks: values() }),
        () => [...inputs.values()].some((el) => el.value.trim() !== ''),
        () => {
          const solution = [...inputs.keys()].map((id, i) => {
            if (question.type === 'fillInBlanks')
              return `${i + 1}: ${(localized(ctx, question.blanks.find((b) => b.id === id)?.accepted ?? {}) ?? []).join(' / ')}`;
            if (question.type === 'selectBlanks') {
              const o = question.blanks.find((b) => b.id === id)?.options.find((x) => x.correct);
              return `${i + 1}: ${o ? (localized(ctx, o.text) ?? '') : ''}`;
            }
            const w = question.words.find((x) => x.id === question.blanks.find((b) => b.id === id)?.wordId);
            return `${i + 1}: ${w ? (localized(ctx, w.text) ?? '') : ''}`;
          });
          fieldset.append(
            h('p', { class: 'lw-solution', text: `${s.correctAnswer}: ${solution.join('; ')}` }),
          );
        },
      );
    }
    case 'matching': {
      const options = shuffle(
        [...question.pairs.map((p) => ({ id: p.id, text: p.right })), ...question.distractors],
        random,
      );
      const selects = new Map<string, HTMLSelectElement>();
      const rows = shuffle(question.pairs, random).map((pair) => {
        const id = nextId('m');
        const select = h('select', { class: 'lw-input', attrs: { id } }, [
          option('', s.choose),
          ...options.map((o) => option(o.id, localized(ctx, o.text) ?? '')),
        ]);
        selects.set(pair.id, select);
        return h('div', { class: 'lw-match-row' }, [
          h('label', { attrs: { for: id }, text: localized(ctx, pair.left) ?? '' }),
          select,
        ]);
      });
      fieldset.append(h('div', { class: 'lw-matching' }, rows));
      return view(
        () => ({
          type: 'matching',
          pairs: Object.fromEntries(
            [...selects].filter(([, el]) => el.value).map(([id, el]) => [id, el.value]),
          ),
        }),
        () => [...selects.values()].some((el) => el.value !== ''),
        () =>
          fieldset.append(
            h('p', {
              class: 'lw-solution',
              text: `${s.correctAnswer}: ${question.pairs.map((p) => `${localized(ctx, p.left) ?? ''} → ${localized(ctx, p.right) ?? ''}`).join('; ')}`,
            }),
          ),
      );
    }
    case 'sequence': {
      let order = shuffle(question.items, random);
      if (order.every((item, i) => item.id === question.items[i]?.id) && order.length > 1)
        order = [...order.slice(1), order[0] as (typeof order)[number]];
      const list = h('ol', { class: 'lw-sequence' });
      const draw = () => {
        list.replaceChildren(
          ...order.map((item, i) => {
            const text = localized(ctx, item.text) ?? '';
            const up = h('button', {
              class: 'lw-icon-button',
              attrs: { type: 'button', 'aria-label': `${s.moveUp}: ${text}` },
              text: '↑',
            });
            const down = h('button', {
              class: 'lw-icon-button',
              attrs: { type: 'button', 'aria-label': `${s.moveDown}: ${text}` },
              text: '↓',
            });
            up.disabled = i === 0;
            down.disabled = i === order.length - 1;
            const move = (delta: number) => {
              const next = [...order];
              const [moved] = next.splice(i, 1);
              if (moved) next.splice(i + delta, 0, moved);
              order = next;
              draw();
              (
                list.children[i + delta]?.querySelector('button:not(:disabled)') as HTMLButtonElement | null
              )?.focus();
            };
            up.addEventListener('click', () => move(-1));
            down.addEventListener('click', () => move(1));
            return h('li', { class: 'lw-seq-item' }, [h('span', { text }), up, down]);
          }),
        );
      };
      draw();
      fieldset.append(list);
      return view(
        () => ({ type: 'sequence', order: order.map((i) => i.id) }),
        () => true,
        () =>
          fieldset.append(
            h('p', {
              class: 'lw-solution',
              text: `${s.correctAnswer}: ${question.items.map((i) => localized(ctx, i.text) ?? '').join(' → ')}`,
            }),
          ),
      );
    }
    case 'dragDrop': {
      const zones = question.zones;
      const width = Math.max(...zones.map((z) => z.frame.x + z.frame.width), 400);
      const height = Math.max(...zones.map((z) => z.frame.y + z.frame.height), 200);
      const board = h('div', { class: 'lw-dd-board' });
      board.style.aspectRatio = `${width} / ${height}`;
      if (question.background) {
        board.append(
          h('img', {
            class: 'lw-dd-bg',
            attrs: {
              src: ctx.assetUrl(question.background.image.$asset),
              alt: localized(ctx, question.background.altText) ?? '',
            },
          }),
        );
      }
      const zoneEls = new Map<string, HTMLElement>();
      for (const zone of zones) {
        const el = h('div', { class: 'lw-dd-zone', attrs: { 'data-zone': zone.id } }, [
          h('span', { class: 'lw-dd-zone-label', text: localized(ctx, zone.label) ?? '' }),
        ]);
        el.style.left = `${(zone.frame.x / width) * 100}%`;
        el.style.top = `${(zone.frame.y / height) * 100}%`;
        el.style.width = `${(zone.frame.width / width) * 100}%`;
        el.style.height = `${(zone.frame.height / height) * 100}%`;
        zoneEls.set(zone.id, el);
        board.append(el);
      }
      const bank = h('div', { class: 'lw-dd-bank' });
      const selects = new Map<string, HTMLSelectElement>();
      const chips = new Map<string, HTMLElement>();
      const place = (itemId: string, zoneId: string) => {
        const chip = chips.get(itemId);
        const select = selects.get(itemId);
        if (!chip || !select) return;
        select.value = zoneId;
        (zoneId ? zoneEls.get(zoneId) : bank)?.append(chip);
      };
      for (const item of shuffle(question.items, random)) {
        const label =
          item.content.type === 'text'
            ? (localized(ctx, item.content.text) ?? '')
            : (localized(ctx, item.content.altText) ?? '');
        const content =
          item.content.type === 'image'
            ? h('img', { attrs: { src: ctx.assetUrl(item.content.image.$asset), alt: label } })
            : h('span', { text: label });
        const select = h('select', { class: 'lw-input', attrs: { 'aria-label': `${s.target}: ${label}` } }, [
          option('', s.notAssigned),
          ...zones.map((z) => option(z.id, localized(ctx, z.label) ?? '')),
        ]);
        select.addEventListener('change', () => place(item.id, select.value));
        const chip = h('div', { class: 'lw-dd-item', attrs: { draggable: 'true', 'data-item': item.id } }, [
          content,
        ]);
        chip.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/plain', item.id));
        selects.set(item.id, select);
        chips.set(item.id, chip);
        bank.append(chip);
      }
      const targets: [string, HTMLElement][] = [...zoneEls, ['', bank]];
      for (const [zoneId, el] of targets) {
        el.addEventListener('dragover', (e) => e.preventDefault());
        el.addEventListener('drop', (e: DragEvent) => {
          e.preventDefault();
          const itemId = e.dataTransfer?.getData('text/plain');
          if (itemId && !selects.get(itemId)?.disabled) place(itemId, zoneId);
        });
      }
      const controls = h(
        'div',
        { class: 'lw-dd-controls' },
        [...selects].map(([itemId, select]) =>
          h('label', { class: 'lw-dd-control' }, [
            h('span', {
              text: chips.get(itemId)?.textContent || (chips.get(itemId)?.querySelector('img')?.alt ?? ''),
            }),
            select,
          ]),
        ),
      );
      fieldset.append(board, bank, controls);
      return view(
        () => ({
          type: 'dragDrop',
          placements: Object.fromEntries([...selects].map(([id, el]) => [id, el.value || null])),
        }),
        () => [...selects.values()].some((el) => el.value !== ''),
        () => {
          for (const item of question.items) {
            const chip = chips.get(item.id);
            const zone = selects.get(item.id)?.value ?? '';
            const ok = item.correctZoneIds.length ? item.correctZoneIds.includes(zone) : zone === '';
            chip?.classList.add(ok ? 'lw-is-correct' : 'lw-is-wrong');
          }
        },
      );
    }
    case 'hotspot': {
      const board = h('div', { class: 'lw-hs-board' }, [
        h('img', {
          class: 'lw-hs-img',
          attrs: {
            src: ctx.assetUrl(question.image.image.$asset),
            alt: localized(ctx, question.image.altText) ?? '',
          },
        }),
      ]);
      const selected = new Set<string>();
      const buttons = new Map<string, HTMLButtonElement>();
      for (const area of question.areas) {
        const button = h('button', {
          class: 'lw-hs-area',
          attrs: { type: 'button', 'aria-pressed': 'false', 'aria-label': localized(ctx, area.label) ?? '' },
        });
        const shape = area.shape;
        const box =
          shape.type === 'rectangle'
            ? {
                x: shape.topLeft.x,
                y: shape.topLeft.y,
                w: shape.bottomRight.x - shape.topLeft.x,
                h: shape.bottomRight.y - shape.topLeft.y,
              }
            : shape.type === 'ellipse'
              ? {
                  x: shape.center.x - shape.rx,
                  y: shape.center.y - shape.ry,
                  w: shape.rx * 2,
                  h: shape.ry * 2,
                }
              : (() => {
                  const xs = shape.points.map((p) => p.x);
                  const ys = shape.points.map((p) => p.y);
                  return {
                    x: Math.min(...xs),
                    y: Math.min(...ys),
                    w: Math.max(...xs) - Math.min(...xs),
                    h: Math.max(...ys) - Math.min(...ys),
                  };
                })();
        button.style.left = `${box.x * 100}%`;
        button.style.top = `${box.y * 100}%`;
        button.style.width = `${box.w * 100}%`;
        button.style.height = `${box.h * 100}%`;
        if (shape.type === 'ellipse') button.style.borderRadius = '50%';
        if (shape.type === 'polygon') {
          button.style.clipPath = `polygon(${shape.points.map((p) => `${((p.x - box.x) / (box.w || 1)) * 100}% ${((p.y - box.y) / (box.h || 1)) * 100}%`).join(',')})`;
        }
        button.addEventListener('click', () => {
          if (!question.multiple) {
            selected.clear();
            for (const b of buttons.values()) b.setAttribute('aria-pressed', 'false');
          }
          if (selected.has(area.id)) selected.delete(area.id);
          else selected.add(area.id);
          button.setAttribute('aria-pressed', String(selected.has(area.id)));
        });
        buttons.set(area.id, button);
        board.append(button);
      }
      fieldset.append(board);
      return view(
        () => ({ type: 'hotspot', areaIds: [...selected] }),
        () => selected.size > 0,
        () => {
          for (const area of question.areas)
            if (area.correct) buttons.get(area.id)?.classList.add('lw-is-correct');
        },
      );
    }
    case 'likert': {
      const table = h('table', { class: 'lw-likert' });
      table.append(
        h('thead', {}, [
          h('tr', {}, [
            h('th', { text: '' }),
            ...question.scale.map((p) =>
              h('th', { attrs: { scope: 'col' }, text: localized(ctx, p.label) ?? '' }),
            ),
          ]),
        ]),
      );
      const body = h('tbody');
      const radios = new Map<string, HTMLInputElement[]>();
      for (const statement of question.statements) {
        const name = nextId('lk');
        const text = localized(ctx, statement.text) ?? '';
        const inputs = question.scale.map((p) =>
          h('input', {
            attrs: {
              type: 'radio',
              name,
              value: p.id,
              'aria-label': `${text}: ${localized(ctx, p.label) ?? ''}`,
            },
          }),
        );
        radios.set(statement.id, inputs);
        body.append(
          h('tr', {}, [h('th', { attrs: { scope: 'row' }, text }), ...inputs.map((i) => h('td', {}, [i]))]),
        );
      }
      table.append(body);
      fieldset.append(table);
      const answers = () =>
        Object.fromEntries(
          [...radios].flatMap(([id, inputs]) => inputs.filter((i) => i.checked).map((i) => [id, i.value])),
        );
      return view(
        () => ({ type: 'likert', answers: answers() }),
        () => Object.keys(answers()).length > 0,
        () => undefined,
      );
    }
  }
}
