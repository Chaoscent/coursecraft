// SPDX-License-Identifier: Apache-2.0
/**
 * XLIFF 2.1 and 1.2 export and import over the course's language maps.
 * Runs in the browser on the course in memory; XML is built and read with
 * DOM APIs (no string concatenation of markup, no HTML parsing).
 *
 * Every translatable map (`{ de: …, en: … }`) becomes a unit named by its
 * path in the course (array items by id where they have one). Rich text is
 * split into one segment per paragraph or heading; marks become paired
 * codes, hard breaks placeholders, link targets and colors stay in
 * original data so translators cannot change them.
 */
import { courseSchema, type Course, type RichText } from '@coursecraft/course-model';

const XLIFF2_NS = 'urn:oasis:names:tc:xliff:document:2.0';
const XLIFF1_NS = 'urn:oasis:names:tc:xliff:document:1.2';
const CC_NS = 'urn:coursecraft:xliff';
const LANG = /^[a-z]{2,3}(-[A-Z]{2})?$/;

type Block = RichText['content'][number];
type TextBlock = Extract<Block, { type: 'paragraph' | 'heading' }>;
type Inline = NonNullable<TextBlock['content']>[number];
type Mark = NonNullable<Extract<Inline, { type: 'text' }>['marks']>[number];

export type XliffVersion = '2.1' | '1.2';

interface Segment {
  id: string;
  source: Inline[];
  target: Inline[] | undefined;
}
interface Unit {
  name: string;
  kind: 'text' | 'list' | 'rich';
  segments: Segment[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isDoc = (v: unknown): v is RichText =>
  isObject(v) && v['type'] === 'doc' && Array.isArray(v['content']);
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function mapKind(value: Record<string, unknown>, source: string): Unit['kind'] | null {
  const keys = Object.keys(value);
  if (!keys.length || !keys.every((k) => LANG.test(k)) || !(source in value)) return null;
  const values = Object.values(value);
  if (values.every((v) => typeof v === 'string')) return 'text';
  if (values.every(isStringList)) return 'list';
  if (values.every(isDoc)) return 'rich';
  return null;
}

const plain = (text: string): Inline[] => (text ? [{ type: 'text', text }] : []);
const flatText = (inlines: Inline[]) => inlines.map((n) => (n.type === 'text' ? n.text : '\n')).join('');

/** Paragraphs and headings of a document, with stable ids through nested lists. */
function textBlocks(doc: RichText): { id: string; block: TextBlock }[] {
  const out: { id: string; block: TextBlock }[] = [];
  const walk = (blocks: Block[], prefix: string) =>
    blocks.forEach((block, i) => {
      const id = prefix ? `${prefix}.${i}` : String(i);
      if (block.type === 'paragraph' || block.type === 'heading') out.push({ id, block });
      else block.content.forEach((item, j) => walk(item.content, `${id}.${j}`));
    });
  walk(doc.content, '');
  return out;
}

function unitFor(
  name: string,
  kind: Unit['kind'],
  map: Record<string, unknown>,
  source: string,
  target: string,
): Unit {
  if (kind === 'text') {
    const t = map[target];
    return {
      name,
      kind,
      segments: [
        {
          id: 's',
          source: plain(map[source] as string),
          target: typeof t === 'string' ? plain(t) : undefined,
        },
      ],
    };
  }
  if (kind === 'list') {
    const s = map[source] as string[];
    const t = map[target] as string[] | undefined;
    return {
      name,
      kind,
      segments: s.map((text, i) => ({
        id: `i${i}`,
        source: plain(text),
        target: t?.[i] !== undefined ? plain(t[i] ?? '') : undefined,
      })),
    };
  }
  const targetBlocks = new Map(isDoc(map[target]) ? textBlocks(map[target]).map((b) => [b.id, b.block]) : []);
  return {
    name,
    kind,
    segments: textBlocks(map[source] as RichText).map(({ id, block }) => ({
      id: `b${id}`,
      source: block.content ?? [],
      target: targetBlocks.has(id) ? (targetBlocks.get(id)?.content ?? []) : undefined,
    })),
  };
}

/** Every translatable map in the course, in document order. */
function collect(
  course: Course,
  source: string,
  target: string,
  visit?: (unit: Unit, map: Record<string, unknown>) => void,
): Unit[] {
  const units: Unit[] = [];
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        const id = isObject(item) && typeof item['id'] === 'string' ? `[${item['id']}]` : String(i);
        walk(item, `${path}/${id}`);
      });
    } else if (isObject(value)) {
      const kind = mapKind(value, source);
      if (kind) {
        const unit = unitFor(path, kind, value, source, target);
        if (unit.segments.length) {
          units.push(unit);
          visit?.(unit, value);
        }
        return;
      }
      for (const [key, child] of Object.entries(value)) walk(child, `${path}/${key}`);
    }
  };
  walk({ meta: course.meta, structure: course.structure, nodes: course.nodes }, '');
  return units;
}

/* ---------- inline markup ---------- */

const MARK_TYPES = ['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript'] as const;
const CTYPE_12: Record<string, string> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underlined',
  strike: 'x-strike',
  subscript: 'x-sub',
  superscript: 'x-sup',
  link: 'x-link',
  textColor: 'x-color',
};

interface Writer {
  doc: XMLDocument;
  ns: string;
  version: XliffVersion;
  /** XLIFF 2.1 original data of the current unit (link targets, colors). */
  data: { id: string; value: string }[];
  next: number;
}

function markValue(mark: Mark): string | undefined {
  if (mark.type === 'link') return mark.attrs.href;
  if (mark.type === 'textColor') return mark.attrs.color;
  return undefined;
}

function writeInlines(w: Writer, parent: Element, inlines: Inline[]): void {
  for (const node of inlines) {
    if (node.type === 'hardBreak') {
      const id = String(++w.next);
      const el = w.version === '2.1' ? w.doc.createElementNS(w.ns, 'ph') : w.doc.createElementNS(w.ns, 'x');
      el.setAttribute('id', id);
      if (w.version === '2.1') {
        el.setAttribute('type', 'fmt');
        el.setAttribute('subType', 'cc:br');
      } else {
        el.setAttribute('ctype', 'lb');
      }
      parent.append(el);
      continue;
    }
    let target = parent;
    for (const mark of node.marks ?? []) {
      const id = String(++w.next);
      const value = markValue(mark);
      let el: Element;
      if (w.version === '2.1') {
        el = w.doc.createElementNS(w.ns, 'pc');
        el.setAttribute('id', id);
        el.setAttribute('type', mark.type === 'link' ? 'link' : 'fmt');
        el.setAttribute('subType', `cc:${mark.type}`);
        if (value !== undefined) {
          const dataId = `d${w.data.length + 1}`;
          w.data.push({ id: dataId, value });
          el.setAttribute('dataRefStart', dataId);
        }
      } else {
        el = w.doc.createElementNS(w.ns, 'g');
        el.setAttribute('id', id);
        el.setAttribute('ctype', CTYPE_12[mark.type] ?? 'x-unknown');
        if (value !== undefined) el.setAttributeNS(CC_NS, 'cc:value', value);
      }
      target.append(el);
      target = el;
    }
    target.append(w.doc.createTextNode(node.text));
  }
}

function markFrom(type: string, value: string | null): Mark | null {
  if ((MARK_TYPES as readonly string[]).includes(type)) return { type } as Mark;
  if (type === 'link' && value) return { type: 'link', attrs: { href: value } };
  if (type === 'textColor' && value) return { type: 'textColor', attrs: { color: value } };
  return null;
}

/** Inline content of a source/target element; unknown markup keeps only its text. */
function readInlines(el: Element, data: Map<string, string>): Inline[] {
  const out: Inline[] = [];
  const walk = (node: Node, marks: Mark[]) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3 || child.nodeType === 4) {
        const text = child.nodeValue ?? '';
        if (!text) continue;
        const last = out.at(-1);
        // Adjacent runs with the same marks merge back into one text node.
        if (last?.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(marks))
          last.text += text;
        else out.push(marks.length ? { type: 'text', text, marks: [...marks] } : { type: 'text', text });
        continue;
      }
      if (child.nodeType !== 1) continue;
      const e = child as Element;
      const name = e.localName;
      if (
        (name === 'ph' && e.getAttribute('subType') === 'cc:br') ||
        (name === 'x' && e.getAttribute('ctype') === 'lb')
      ) {
        out.push({ type: 'hardBreak' });
      } else if (name === 'pc') {
        const type = (e.getAttribute('subType') ?? '').replace(/^cc:/, '');
        const ref = e.getAttribute('dataRefStart');
        const mark = markFrom(type, ref ? (data.get(ref) ?? null) : null);
        walk(e, mark ? [...marks, mark] : marks);
      } else if (name === 'g') {
        const ctype = e.getAttribute('ctype') ?? '';
        const type = Object.entries(CTYPE_12).find(([, c]) => c === ctype)?.[0] ?? '';
        const mark = markFrom(type, e.getAttributeNS(CC_NS, 'value'));
        walk(e, mark ? [...marks, mark] : marks);
      } else {
        walk(e, marks);
      }
    }
  };
  walk(el, []);
  return out;
}

/* ---------- export ---------- */

export function exportXliff(course: Course, target: string, version: XliffVersion = '2.1'): string {
  const source = course.languages.default;
  const units = collect(course, source, target);
  const ns = version === '2.1' ? XLIFF2_NS : XLIFF1_NS;
  const doc = document.implementation.createDocument(ns, 'xliff', null);
  const root = doc.documentElement;
  root.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:cc', CC_NS);
  const title = course.meta.title[source] ?? 'course';
  const el = (name: string, parent: Element, attrs: Record<string, string> = {}) => {
    const e = doc.createElementNS(ns, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent.append(e);
    return e;
  };

  if (version === '2.1') {
    root.setAttribute('version', '2.1');
    root.setAttribute('srcLang', source);
    root.setAttribute('trgLang', target);
    const file = el('file', root, { id: 'f1', original: title });
    units.forEach((unit, ui) => {
      const u = el('unit', file, { id: `u${ui + 1}`, name: unit.name });
      const w: Writer = { doc, ns, version, data: [], next: 0 };
      const segments = unit.segments.map((segment) => {
        const seg = doc.createElementNS(ns, 'segment');
        seg.setAttribute('id', segment.id);
        writeInlines(w, el('source', seg), segment.source);
        if (segment.target) writeInlines(w, el('target', seg), segment.target);
        return seg;
      });
      if (w.data.length) {
        const original = el('originalData', u);
        for (const d of w.data) el('data', original, { id: d.id }).append(doc.createTextNode(d.value));
      }
      u.append(...segments);
    });
  } else {
    root.setAttribute('version', '1.2');
    const file = el('file', root, {
      original: title,
      'source-language': source,
      'target-language': target,
      datatype: 'plaintext',
    });
    const body = el('body', file);
    let n = 0;
    for (const unit of units) {
      for (const segment of unit.segments) {
        const tu = el('trans-unit', body, { id: `t${++n}`, resname: `${unit.name}#${segment.id}` });
        const w: Writer = { doc, ns, version, data: [], next: 0 };
        writeInlines(w, el('source', tu), segment.source);
        if (segment.target) writeInlines(w, el('target', tu), segment.target);
      }
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(doc)}`;
}

/* ---------- import ---------- */

export class XliffError extends Error {}

export interface ImportResult {
  course: Course;
  lang: string;
  updated: number;
  /** Units from the file that did not match the course (changed since export). */
  skipped: number;
}

/** Targets by unit name and segment id. */
function readTargets(xml: string): {
  source: string;
  target: string;
  units: Map<string, Map<string, Inline[]>>;
} {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (root.localName !== 'xliff' || doc.getElementsByTagName('parsererror').length) {
    throw new XliffError('not-xliff');
  }
  const units = new Map<string, Map<string, Inline[]>>();
  const add = (name: string, segment: string, inlines: Inline[]) => {
    const unit = units.get(name) ?? new Map<string, Inline[]>();
    unit.set(segment, inlines);
    units.set(name, unit);
  };
  const children = (e: Element, name: string) =>
    Array.from(e.getElementsByTagNameNS(root.namespaceURI, name));
  if (root.namespaceURI === XLIFF2_NS) {
    const source = root.getAttribute('srcLang') ?? '';
    const target = root.getAttribute('trgLang') ?? '';
    for (const unit of children(root, 'unit')) {
      const name = unit.getAttribute('name');
      if (!name) continue;
      const data = new Map(children(unit, 'data').map((d) => [d.getAttribute('id') ?? '', d.textContent]));
      for (const segment of children(unit, 'segment')) {
        const t = children(segment, 'target')[0];
        if (t) add(name, segment.getAttribute('id') ?? '', readInlines(t, data));
      }
    }
    return { source, target, units };
  }
  if (root.namespaceURI === XLIFF1_NS) {
    const file = children(root, 'file')[0];
    const source = file?.getAttribute('source-language') ?? '';
    const target = file?.getAttribute('target-language') ?? '';
    for (const tu of children(root, 'trans-unit')) {
      const [name, segment] = (tu.getAttribute('resname') ?? '').split('#');
      const t = children(tu, 'target')[0];
      if (name && segment && t) add(name, segment, readInlines(t, new Map()));
    }
    return { source, target, units };
  }
  throw new XliffError('not-xliff');
}

function cloneWithTargets(doc: RichText, targets: Map<string, Inline[]>): RichText {
  const copy = structuredClone(doc);
  for (const { id, block } of textBlocks(copy)) {
    const inlines = targets.get(`b${id}`) ?? [];
    if (inlines.length) block.content = inlines;
    else delete block.content;
  }
  return copy;
}

/**
 * Applies the translations of an XLIFF file to a copy of the course. Units
 * whose segments no longer match the course are skipped as a whole. The
 * result is validated against the course format.
 */
export function importXliff(course: Course, xml: string): ImportResult {
  const { source, target, units } = readTargets(xml);
  if (!LANG.test(target)) throw new XliffError('no-target-language');
  if (source !== course.languages.default) throw new XliffError('source-language-mismatch');
  if (target === source) throw new XliffError('same-language');
  const copy = structuredClone(course);
  let updated = 0;
  const seen = new Set<string>();
  collect(copy, source, target, (unit, map) => {
    const targets = units.get(unit.name);
    if (!targets) return;
    seen.add(unit.name);
    if (!unit.segments.every((s) => targets.has(s.id))) return;
    const values = unit.segments.map((s) => targets.get(s.id) ?? []);
    if (unit.kind === 'text') map[target] = flatText(values[0] ?? []);
    else if (unit.kind === 'list') map[target] = values.map(flatText);
    else map[target] = cloneWithTargets(map[source] as RichText, targets);
    updated += 1;
  });
  if (!copy.languages.available.includes(target)) copy.languages.available.push(target);
  const checked = courseSchema.safeParse(copy);
  if (!checked.success) throw new XliffError('invalid-result');
  return {
    course: checked.data,
    lang: target,
    updated,
    skipped: [...units.keys()].filter((n) => !seen.has(n)).length,
  };
}
