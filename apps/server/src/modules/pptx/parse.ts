// SPDX-License-Identifier: Apache-2.0
import type { ImportWarning } from '@coursecraft/shared';
import { posix } from 'node:path';
import { AppError } from '../../http/errors.js';
import type { ZipArchive } from '../../lib/zip.js';
import { newId } from '../courses/document.js';
import { resolveColorElement, resolveFill, themeScheme, type ColorContext } from './colors.js';
import {
  attr,
  child,
  children,
  descendants,
  intAttr,
  NS,
  parseXml,
  path,
  type Document,
  type Element,
} from './xml.js';

const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const DC = 'http://purl.org/dc/elements/1.1/';

const MAIN_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml',
  'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml',
]);
const REL_TYPE = {
  officeDocument: '/officeDocument',
  slide: '/slide',
  slideLayout: '/slideLayout',
  slideMaster: '/slideMaster',
  theme: '/theme',
  notesSlide: '/notesSlide',
} as const;
const RASTER_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']);
const MAX_SLIDES = 1000;
const MAX_ELEMENTS = 500;
const MAX_XML_BYTES = 20 * 1024 * 1024;
const LINE_SHAPES = new Set([
  'line',
  'straightConnector1',
  'bentConnector2',
  'bentConnector3',
  'curvedConnector3',
]);
const PRESET_SHAPES: Record<string, 'rectangle' | 'ellipse' | 'triangle' | 'arrow'> = {
  rect: 'rectangle',
  roundRect: 'rectangle',
  snip1Rect: 'rectangle',
  snip2SameRect: 'rectangle',
  round1Rect: 'rectangle',
  round2SameRect: 'rectangle',
  flowChartProcess: 'rectangle',
  flowChartAlternateProcess: 'rectangle',
  ellipse: 'ellipse',
  flowChartConnector: 'ellipse',
  triangle: 'triangle',
  rtTriangle: 'triangle',
  rightArrow: 'arrow',
};
const ENTRANCE_EFFECTS: Record<number, 'fade' | 'fly' | 'wipe' | 'zoom'> = {
  10: 'fade',
  2: 'fly',
  22: 'wipe',
  23: 'zoom',
  53: 'zoom',
};
/** presetSubtype → direction the element comes from. */
const DIRECTIONS: Record<number, 'left' | 'right' | 'up' | 'down'> = {
  1: 'up',
  2: 'right',
  4: 'down',
  8: 'left',
};

type Json = Record<string, unknown>;

export interface PendingImage {
  key: string;
  /** Path of the media part inside the archive. */
  part: string;
  /** Cropping in fractions of the source image (srcRect). */
  crop?: { left: number; top: number; right: number; bottom: number };
}

export interface ParsedSlide {
  /** Position in the presentation (0-based), including hidden slides: page number of the rendering. */
  index: number;
  node: Json;
  /** Content was skipped; the rendered image shows the slide faithfully. */
  lossy: boolean;
}

export interface ParsedPresentation {
  title: string;
  canvas: { width: number; height: number };
  chapters: { title: string; slideIds: string[] }[];
  slides: ParsedSlide[];
  images: PendingImage[];
  warnings: ImportWarning[];
  /** Number of slides in the file, hidden ones included. */
  totalSlides: number;
}

interface Rel {
  type: string;
  target: string;
  external: boolean;
}

interface Part {
  path: string;
  doc: Document;
  root: Element;
  rels: Map<string, Rel>;
}

/** Coordinate mapping from a (group) child space to slide pixels. */
interface Transform {
  ox: number;
  oy: number;
  cx: number;
  cy: number;
  sx: number;
  sy: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

const invalid = (message: string) => new AppError('invalid_file', message);

class Reader {
  readonly #zip: ZipArchive;
  readonly #cache = new Map<string, Part>();

  constructor(zip: ZipArchive) {
    this.#zip = zip;
  }

  async xml(name: string): Promise<Document> {
    if (this.#zip.size(name) > MAX_XML_BYTES) throw invalid('Presentation part too large');
    return parseXml(await this.#zip.read(name));
  }

  async rels(partPath: string): Promise<Map<string, Rel>> {
    const relsPath = posix.join(posix.dirname(partPath), '_rels', `${posix.basename(partPath)}.rels`);
    const out = new Map<string, Rel>();
    if (!this.#zip.has(relsPath)) return out;
    const doc = await this.xml(relsPath);
    for (const rel of children(doc.documentElement, NS.rel, 'Relationship')) {
      const id = attr(rel, 'Id');
      const target = attr(rel, 'Target');
      if (!id || !target) continue;
      const external = attr(rel, 'TargetMode') === 'External';
      const resolved = external
        ? target
        : target.startsWith('/')
          ? target.slice(1)
          : posix.normalize(posix.join(posix.dirname(partPath), target));
      out.set(id, { type: attr(rel, 'Type') ?? '', target: resolved, external });
    }
    return out;
  }

  async part(name: string): Promise<Part> {
    const cached = this.#cache.get(name);
    if (cached) return cached;
    if (name.startsWith('..') || !this.#zip.has(name)) throw invalid(`Missing part ${name}`);
    const doc = await this.xml(name);
    if (!doc.documentElement) throw invalid(`Empty part ${name}`);
    const part = { path: name, doc, root: doc.documentElement, rels: await this.rels(name) };
    this.#cache.set(name, part);
    return part;
  }

  async related(part: Part, type: string): Promise<Part | undefined> {
    const rel = [...part.rels.values()].find((r) => !r.external && r.type.endsWith(type));
    return rel && this.#zip.has(rel.target) ? this.part(rel.target) : undefined;
  }

  has(name: string): boolean {
    return this.#zip.has(name);
  }
}

const textOf = (el: Element | null | undefined): string =>
  descendants(el, NS.a, 't')
    .map((t) => t.textContent ?? '')
    .join('');

function placeholderOf(sp: Element): { type: string; idx: string | undefined } | null {
  const ph = path(sp, [NS.p, 'nvSpPr'], [NS.p, 'nvPr'], [NS.p, 'ph']);
  if (!ph) return null;
  const type = attr(ph, 'type') ?? 'obj';
  return { type: type === 'ctrTitle' ? 'title' : type, idx: attr(ph, 'idx') };
}

function textKind(type: string | undefined): 'title' | 'body' | 'other' {
  if (type === 'title') return 'title';
  if (type === undefined) return 'other';
  return ['body', 'obj', 'subTitle'].includes(type) ? 'body' : 'other';
}

/** Placeholder on a layout or master that a slide shape inherits from. */
function findPlaceholder(
  part: Part | undefined,
  ph: { type: string; idx: string | undefined },
): Element | null {
  if (!part) return null;
  const shapes = descendants(part.root, NS.p, 'sp');
  const withPh = shapes.map((sp) => ({ sp, ph: placeholderOf(sp) })).filter((s) => s.ph);
  return (
    (ph.idx !== undefined ? withPh.find((s) => s.ph?.idx === ph.idx)?.sp : undefined) ??
    withPh.find((s) => s.ph?.type === ph.type)?.sp ??
    (ph.type === 'obj' || ph.type === 'subTitle'
      ? withPh.find((s) => s.ph?.type === 'body')?.sp
      : undefined) ??
    null
  );
}

interface SlideContext {
  reader: Reader;
  slide: Part;
  layout: Part | undefined;
  master: Part | undefined;
  colors: ColorContext;
  /** Pixels per EMU. */
  scale: number;
  lang: string;
  images: PendingImage[];
  warnings: Set<ImportWarning['code']>;
  /** cNvPr id → element id, for animations. */
  ids: Map<string, string>;
}

/** Element chain for inheritance: the shape itself, then layout and master placeholders. */
function inheritanceChain(sp: Element, ctx: SlideContext): Element[] {
  const ph = placeholderOf(sp);
  if (!ph) return [sp];
  const layoutSp = findPlaceholder(ctx.layout, ph);
  const masterPh = layoutSp ? (placeholderOf(layoutSp) ?? ph) : ph;
  const masterSp = findPlaceholder(ctx.master, masterPh);
  return [sp, layoutSp, masterSp].filter((e): e is Element => e !== null);
}

function txStyle(ctx: SlideContext, kind: 'title' | 'body' | 'other'): Element | null {
  return path(ctx.master?.root, [NS.p, 'txStyles'], [NS.p, `${kind}Style`]);
}

/** First match of a paragraph-level property through the inheritance chain. */
function levelProps(
  chain: Element[],
  ctx: SlideContext,
  kind: 'title' | 'body' | 'other',
  lvl: number,
): Element[] {
  const name = `lvl${lvl + 1}pPr`;
  const out: Element[] = [];
  for (const el of chain) {
    const p = path(el, [NS.p, 'txBody'], [NS.a, 'lstStyle'], [NS.a, name]);
    if (p) out.push(p);
  }
  const fromMaster = child(txStyle(ctx, kind), NS.a, name);
  if (fromMaster) out.push(fromMaster);
  return out;
}

function geometry(xfrm: Element | null, t: Transform): Box | null {
  const off = child(xfrm, NS.a, 'off');
  const ext = child(xfrm, NS.a, 'ext');
  if (!off || !ext) return null;
  const x = intAttr(off, 'x') ?? 0;
  const y = intAttr(off, 'y') ?? 0;
  const w = intAttr(ext, 'cx') ?? 0;
  const h = intAttr(ext, 'cy') ?? 0;
  return {
    x: t.ox + (x - t.cx) * t.sx,
    y: t.oy + (y - t.cy) * t.sy,
    width: w * t.sx,
    height: h * t.sy,
    rotation: (intAttr(xfrm, 'rot') ?? 0) / 60_000,
    flipH: attr(xfrm, 'flipH') === '1',
    flipV: attr(xfrm, 'flipV') === '1',
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

function frame(box: Box): Json {
  const rotation = ((box.rotation + 540) % 360) - 180;
  return {
    x: round(box.x),
    y: round(box.y),
    width: Math.max(1, round(box.width)),
    height: Math.max(1, round(box.height)),
    rotation: round(rotation),
  };
}

function fontFamily(typeface: string | undefined): 'sans' | 'serif' | 'mono' | undefined {
  if (!typeface) return undefined;
  if (/mono|courier|consolas|menlo/i.test(typeface)) return 'mono';
  if (
    /serif|times|georgia|cambria|garamond|caladea|book antiqua|palatino/i.test(typeface) &&
    !/sans/i.test(typeface)
  )
    return 'serif';
  return 'sans';
}

interface RunDefaults {
  sizePt: number;
  color: string | undefined;
  font: 'sans' | 'serif' | 'mono' | undefined;
}

function runDefaults(levels: Element[], ctx: SlideContext, fallbackColor: string | undefined): RunDefaults {
  let sizePt: number | undefined;
  let color: string | undefined;
  let font: RunDefaults['font'];
  for (const lvl of levels) {
    const def = child(lvl, NS.a, 'defRPr');
    sizePt ??= intAttr(def, 'sz') !== undefined ? (intAttr(def, 'sz') ?? 1800) / 100 : undefined;
    color ??= resolveFill(child(def, NS.a, 'solidFill'), ctx.colors);
    font ??= fontFamily(attr(child(def, NS.a, 'latin'), 'typeface')?.replace(/^\+m[jn]-lt$/, ''));
  }
  return { sizePt: sizePt ?? 18, color: color ?? fallbackColor, font };
}

function bulletOf(pPr: Element | null, levels: Element[]): 'bullet' | 'ordered' | null {
  for (const el of [pPr, ...levels]) {
    if (!el) continue;
    if (child(el, NS.a, 'buNone')) return null;
    if (child(el, NS.a, 'buAutoNum')) return 'ordered';
    if (child(el, NS.a, 'buChar') || child(el, NS.a, 'buBlip')) return 'bullet';
  }
  return null;
}

function alignOf(
  pPr: Element | null,
  levels: Element[],
): 'left' | 'center' | 'right' | 'justify' | undefined {
  for (const el of [pPr, ...levels]) {
    const algn = attr(el, 'algn');
    if (algn)
      return algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : 'left';
  }
  return undefined;
}

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

function runMarks(rPr: Element | null, defaultColor: string | undefined, ctx: SlideContext): Json[] {
  const marks: Json[] = [];
  if (!rPr) return marks;
  if (attr(rPr, 'b') === '1') marks.push({ type: 'bold' });
  if (attr(rPr, 'i') === '1') marks.push({ type: 'italic' });
  const u = attr(rPr, 'u');
  if (u && u !== 'none') marks.push({ type: 'underline' });
  const strike = attr(rPr, 'strike');
  if (strike && strike !== 'noStrike') marks.push({ type: 'strike' });
  const baseline = intAttr(rPr, 'baseline') ?? 0;
  if (baseline > 0) marks.push({ type: 'superscript' });
  if (baseline < 0) marks.push({ type: 'subscript' });
  const color = resolveFill(child(rPr, NS.a, 'solidFill'), ctx.colors);
  if (color && color !== defaultColor) marks.push({ type: 'textColor', attrs: { color } });
  const link = child(rPr, NS.a, 'hlinkClick');
  const rel = link ? ctx.slide.rels.get(attr(link, 'id', NS.r) ?? '') : undefined;
  if (rel?.external && SAFE_HREF.test(rel.target) && rel.target.length <= 2000)
    marks.push({ type: 'link', attrs: { href: rel.target } });
  return marks;
}

interface TextResult {
  doc: Json;
  sizePt: number | undefined;
  color: string | undefined;
  font: RunDefaults['font'];
  hasText: boolean;
}

/** DrawingML paragraphs → rich text document; consecutive bullet paragraphs become lists. */
function convertText(
  txBody: Element | null,
  chain: Element[],
  ctx: SlideContext,
  kind: 'title' | 'body' | 'other',
  fallbackColor: string | undefined,
  allowBullets = true,
): TextResult {
  const blocks: Json[] = [];
  let list: { type: 'bulletList' | 'orderedList'; content: Json[] } | null = null;
  let firstSize: number | undefined;
  let firstColor: string | undefined;
  let firstFont: RunDefaults['font'];
  let hasText = false;
  const defaults0 = runDefaults(levelProps(chain, ctx, kind, 0), ctx, fallbackColor);

  for (const p of children(txBody, NS.a, 'p')) {
    const pPr = child(p, NS.a, 'pPr');
    const lvl = Math.min(8, intAttr(pPr, 'lvl') ?? 0);
    const levels = levelProps(chain, ctx, kind, lvl);
    const defaults = runDefaults(levels, ctx, fallbackColor);
    const inline: Json[] = [];
    for (const node of children(p, NS.a)) {
      if (node.localName === 'br') inline.push({ type: 'hardBreak' });
      if (node.localName !== 'r' && node.localName !== 'fld') continue;
      const text = (child(node, NS.a, 't')?.textContent ?? '').slice(0, 20_000);
      if (!text) continue;
      const rPr = child(node, NS.a, 'rPr');
      hasText ||= text.trim().length > 0;
      if (firstSize === undefined && text.trim()) {
        const sz = intAttr(rPr, 'sz');
        firstSize = sz !== undefined ? sz / 100 : defaults.sizePt;
        firstColor = resolveFill(child(rPr, NS.a, 'solidFill'), ctx.colors) ?? defaults.color;
        firstFont = fontFamily(attr(child(rPr, NS.a, 'latin'), 'typeface')) ?? defaults.font;
      }
      const marks = runMarks(rPr, defaults0.color ?? firstColor, ctx).slice(0, 8);
      inline.push({ type: 'text', text, ...(marks.length ? { marks } : {}) });
    }
    const align = alignOf(pPr, levels);
    const paragraph: Json = {
      type: 'paragraph',
      ...(align && align !== 'left' ? { attrs: { align } } : {}),
      ...(inline.length ? { content: inline } : {}),
    };
    const bullet = allowBullets && inline.length ? bulletOf(pPr, levels) : null;
    if (bullet) {
      const type = bullet === 'ordered' ? 'orderedList' : 'bulletList';
      if (!list || list.type !== type) {
        list = { type, content: [] };
        blocks.push(list);
      }
      list.content.push({ type: 'listItem', content: [paragraph] });
    } else {
      list = null;
      blocks.push(paragraph);
    }
  }
  return {
    doc: { type: 'doc', content: blocks.slice(0, 1000) },
    sizePt: firstSize,
    color: firstColor,
    font: firstFont,
    hasText,
  };
}

function bodyProps(chain: Element[]): {
  anchor: string | undefined;
  fontScale: number;
  inset: number | undefined;
} {
  let anchor: string | undefined;
  let fontScale: number | undefined;
  let inset: number | undefined;
  for (const el of chain) {
    const bodyPr = path(el, [NS.p, 'txBody'], [NS.a, 'bodyPr']);
    anchor ??= attr(bodyPr, 'anchor');
    inset ??= intAttr(bodyPr, 'lIns');
    const fit = child(bodyPr, NS.a, 'normAutofit');
    if (fit && fontScale === undefined) fontScale = (intAttr(fit, 'fontScale') ?? 100_000) / 100_000;
  }
  return { anchor, fontScale: fontScale ?? 1, inset };
}

function textStyle(text: TextResult, chain: Element[], ctx: SlideContext): Json {
  const body = bodyProps(chain);
  const pt = (text.sizePt ?? 18) * body.fontScale;
  return {
    font: text.font ?? 'sans',
    sizePx: Math.min(400, Math.max(6, round(pt * 12_700 * ctx.scale))),
    lineHeight: 1.2,
    ...(text.color ? { color: text.color } : {}),
    verticalAlign: body.anchor === 'ctr' ? 'middle' : body.anchor === 'b' ? 'bottom' : 'top',
    paddingPx: Math.min(200, Math.max(0, round((body.inset ?? 91_440) * ctx.scale))),
  };
}

function shapeStyleColor(
  sp: Element,
  ref: 'fillRef' | 'lnRef' | 'fontRef',
  ctx: SlideContext,
): string | undefined {
  const r = path(sp, [NS.p, 'style'], [NS.a, ref]);
  if (!r || (ref !== 'fontRef' && (intAttr(r, 'idx') ?? 0) === 0)) return undefined;
  const color = children(r, NS.a).find((c) => (c.localName ?? '').endsWith('Clr'));
  return color ? resolveColorElement(color, ctx.colors) : undefined;
}

function fillOf(spPr: Element | null, sp: Element, ctx: SlideContext): string | null | undefined {
  if (child(spPr, NS.a, 'noFill')) return null;
  const fill = child(spPr, NS.a, 'solidFill') ?? child(spPr, NS.a, 'gradFill');
  if (fill) return resolveFill(fill, ctx.colors);
  return shapeStyleColor(sp, 'fillRef', ctx);
}

function strokeOf(spPr: Element | null, sp: Element, ctx: SlideContext): Json | undefined {
  const ln = child(spPr, NS.a, 'ln');
  if (child(ln, NS.a, 'noFill')) return undefined;
  const color = resolveFill(child(ln, NS.a, 'solidFill'), ctx.colors) ?? shapeStyleColor(sp, 'lnRef', ctx);
  if (!color) return undefined;
  const width = Math.max(1, round((intAttr(ln, 'w') ?? 12_700) * ctx.scale));
  return { color, widthPx: Math.min(100, width) };
}

function base(id: string, name: string, box: Box, hidden: boolean): Json {
  return { id, name: name.slice(0, 200), frame: frame(box), hidden };
}

function nvProps(el: Element): Element | null {
  const nv = children(el, NS.p).find((c) => (c.localName ?? '').startsWith('nv'));
  return child(nv, NS.p, 'cNvPr');
}

function registerId(
  el: Element,
  ctx: SlideContext,
  prefix: string,
): { id: string; name: string; hidden: boolean; descr: string | undefined } {
  const c = nvProps(el);
  const id = newId(prefix);
  const spid = attr(c, 'id');
  if (spid) ctx.ids.set(spid, id);
  return { id, name: attr(c, 'name') ?? prefix, hidden: attr(c, 'hidden') === '1', descr: attr(c, 'descr') };
}

function lineElement(
  box: Box,
  stroke: Json | undefined,
  meta: { id: string; name: string; hidden: boolean },
  arrow: boolean,
): Json {
  // A line runs corner to corner of its box; express it as a rotated horizontal line.
  const dx = box.width * (box.flipH ? -1 : 1);
  const dy = box.height * (box.flipV ? -1 : 1);
  const length = Math.max(1, Math.hypot(dx, dy));
  const thickness = Math.max(8, Number(stroke?.['widthPx'] ?? 2) * 6);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const lineBox: Box = {
    x: cx - length / 2,
    y: cy - thickness / 2,
    width: length,
    height: thickness,
    rotation: (Math.atan2(dy, dx) * 180) / Math.PI + box.rotation,
    flipH: false,
    flipV: false,
  };
  return {
    ...base(meta.id, meta.name, lineBox, meta.hidden),
    type: 'shape',
    shape: arrow ? 'arrow' : 'line',
    stroke: stroke ?? { color: '#000000', widthPx: 2 },
    decorative: true,
  };
}

function convertShape(sp: Element, t: Transform, ctx: SlideContext): Json | null {
  const chain = inheritanceChain(sp, ctx);
  const spPr = child(sp, NS.p, 'spPr');
  const xfrm = chain.map((el) => path(el, [NS.p, 'spPr'], [NS.a, 'xfrm'])).find((x) => x) ?? null;
  const box = geometry(xfrm, t);
  if (!box) return null;
  const meta = registerId(sp, ctx, 'e');
  const ph = placeholderOf(sp);
  const kind = textKind(ph?.type);
  const prst = attr(child(spPr, NS.a, 'prstGeom'), 'prst');
  const custom = child(spPr, NS.a, 'custGeom') !== null;
  const fill = fillOf(spPr, sp, ctx);
  const stroke = strokeOf(spPr, sp, ctx);

  if (prst && LINE_SHAPES.has(prst)) {
    const ln = child(spPr, NS.a, 'ln');
    return lineElement(
      box,
      stroke,
      meta,
      child(ln, NS.a, 'tailEnd') !== null && attr(child(ln, NS.a, 'tailEnd'), 'type') !== 'none',
    );
  }

  const fontColor = shapeStyleColor(sp, 'fontRef', ctx) ?? ctx.colors.scheme[ctx.colors.map['tx1'] ?? 'dk1'];
  const text = convertText(
    child(sp, NS.p, 'txBody'),
    chain,
    ctx,
    kind,
    fontColor ? `#${fontColor.replace('#', '')}` : undefined,
  );
  const content = text.hasText ? { [ctx.lang]: text.doc } : undefined;

  if (custom) {
    ctx.warnings.add('unsupported_content');
    return null;
  }
  const shape = prst ? PRESET_SHAPES[prst] : 'rectangle';
  if (!shape) ctx.warnings.add('unsupported_content');
  const visible = fill !== null && fill !== undefined;

  if (!visible && !stroke) {
    if (!content) return null;
    return {
      ...base(meta.id, meta.name, box, meta.hidden),
      type: 'text',
      content,
      style: textStyle(text, chain, ctx),
    };
  }
  return {
    ...base(meta.id, meta.name, box, meta.hidden),
    type: 'shape',
    shape: shape ?? 'rectangle',
    ...(visible ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
    ...(content ? { content, textStyle: textStyle(text, chain, ctx) } : {}),
    ...(meta.descr ? { altText: { [ctx.lang]: meta.descr.slice(0, 2000) } } : { decorative: !content }),
  };
}

function convertPicture(pic: Element, t: Transform, ctx: SlideContext): Json | null {
  const box = geometry(path(pic, [NS.p, 'spPr'], [NS.a, 'xfrm']), t);
  if (!box) return null;
  const meta = registerId(pic, ctx, 'e');
  const nvPr = path(pic, [NS.p, 'nvPicPr'], [NS.p, 'nvPr']);
  if (child(nvPr, NS.a, 'videoFile') || child(nvPr, NS.a, 'audioFile') || child(nvPr, NS.a, 'quickTimeFile'))
    ctx.warnings.add('media_skipped');
  const blipFill = child(pic, NS.p, 'blipFill');
  const blip = child(blipFill, NS.a, 'blip');
  const rel = ctx.slide.rels.get(attr(blip, 'embed', NS.r) ?? '');
  if (!rel || rel.external) {
    ctx.warnings.add('unsupported_image');
    return null;
  }
  const ext = posix.extname(rel.target).slice(1).toLowerCase();
  if (!RASTER_EXT.has(ext) || !ctx.reader.has(rel.target)) {
    ctx.warnings.add('unsupported_image');
    return null;
  }
  const src = child(blipFill, NS.a, 'srcRect');
  const crop = src
    ? {
        left: (intAttr(src, 'l') ?? 0) / 100_000,
        top: (intAttr(src, 't') ?? 0) / 100_000,
        right: (intAttr(src, 'r') ?? 0) / 100_000,
        bottom: (intAttr(src, 'b') ?? 0) / 100_000,
      }
    : undefined;
  const key = `pending:${ctx.images.length}`;
  ctx.images.push({
    key,
    part: rel.target,
    ...(crop && Object.values(crop).some((v) => v !== 0) ? { crop } : {}),
  });
  return {
    ...base(meta.id, meta.name, box, meta.hidden),
    type: 'image',
    image: { $asset: key },
    fit: 'fill',
    ...(meta.descr ? { altText: { [ctx.lang]: meta.descr.slice(0, 2000) } } : {}),
  };
}

function groupTransform(grp: Element, t: Transform): { box: Box; inner: Transform } | null {
  const xfrm = path(grp, [NS.p, 'grpSpPr'], [NS.a, 'xfrm']);
  const box = geometry(xfrm, t);
  const chOff = child(xfrm, NS.a, 'chOff');
  const chExt = child(xfrm, NS.a, 'chExt');
  if (!box) return null;
  const chW = intAttr(chExt, 'cx') ?? 0;
  const chH = intAttr(chExt, 'cy') ?? 0;
  const ext = child(xfrm, NS.a, 'ext');
  const w = intAttr(ext, 'cx') ?? 0;
  const h = intAttr(ext, 'cy') ?? 0;
  return {
    box,
    inner: {
      ox: box.x,
      oy: box.y,
      cx: intAttr(chOff, 'x') ?? 0,
      cy: intAttr(chOff, 'y') ?? 0,
      sx: chW > 0 ? (w / chW) * t.sx : t.sx,
      sy: chH > 0 ? (h / chH) * t.sy : t.sy,
    },
  };
}

function convertTree(tree: Element, t: Transform, ctx: SlideContext): Json[] {
  const out: Json[] = [];
  for (const el of children(tree, NS.p)) {
    const converted = convertNode(el, t, ctx);
    if (converted) out.push(converted);
  }
  for (const alt of children(tree, MC, 'AlternateContent')) {
    // Newer features come with a fallback in plain DrawingML.
    const fallback = child(alt, MC, 'Fallback');
    if (fallback) out.push(...convertTree(fallback, t, ctx));
  }
  return out;
}

function convertNode(el: Element, t: Transform, ctx: SlideContext): Json | null {
  switch (el.localName) {
    case 'sp':
      return convertShape(el, t, ctx);
    case 'cxnSp': {
      const box = geometry(path(el, [NS.p, 'spPr'], [NS.a, 'xfrm']), t);
      if (!box) return null;
      const meta = registerId(el, ctx, 'e');
      const spPr = child(el, NS.p, 'spPr');
      const ln = child(spPr, NS.a, 'ln');
      const tail = attr(child(ln, NS.a, 'tailEnd'), 'type');
      return lineElement(box, strokeOf(spPr, el, ctx), meta, tail !== undefined && tail !== 'none');
    }
    case 'pic':
      return convertPicture(el, t, ctx);
    case 'grpSp': {
      const g = groupTransform(el, t);
      if (!g) return null;
      const meta = registerId(el, ctx, 'g');
      const kids = convertTree(el, g.inner, ctx).slice(0, 200);
      if (!kids.length) return null;
      const origin = frame(g.box);
      for (const kid of kids) {
        const f = kid['frame'] as { x: number; y: number };
        f.x = round(f.x - Number(origin['x']));
        f.y = round(f.y - Number(origin['y']));
      }
      return { ...base(meta.id, meta.name, g.box, meta.hidden), type: 'group', children: kids };
    }
    case 'graphicFrame':
    case 'contentPart':
      ctx.warnings.add('unsupported_content');
      return null;
    default:
      return null;
  }
}

interface Animation {
  startMs: number;
  effect: 'fade' | 'fly' | 'wipe' | 'zoom' | null;
  direction: 'left' | 'right' | 'up' | 'down' | undefined;
  durationMs: number;
}

/**
 * Entrance animations → element timing. Click steps become timed steps one
 * second apart; the author adjusts them on the timeline.
 */
function readAnimations(slide: Element): Map<string, Animation> {
  const out = new Map<string, Animation>();
  const timing = child(slide, NS.p, 'timing');
  let clockEnd = 0;
  let prevStart = 0;
  let prevEnd = 0;
  for (const ctn of descendants(timing, NS.p, 'cTn')) {
    if (attr(ctn, 'presetClass') !== 'entr') continue;
    const spid = attr(descendants(ctn, NS.p, 'spTgt')[0], 'spid');
    if (!spid || out.has(spid)) continue;
    const delayAttr = attr(descendants(ctn, NS.p, 'cond')[0], 'delay');
    const delay = delayAttr && /^\d+$/.test(delayAttr) ? Number(delayAttr) : 0;
    const durations = descendants(ctn, NS.p, 'cTn')
      .map((c) => attr(c, 'dur'))
      .filter((d): d is string => d !== undefined && /^\d+$/.test(d))
      .map(Number);
    const durationMs = Math.min(10_000, Math.max(50, durations.length ? Math.max(...durations) : 500));
    const nodeType = attr(ctn, 'nodeType');
    const start =
      nodeType === 'withEffect'
        ? prevStart + delay
        : nodeType === 'afterEffect'
          ? prevEnd + delay
          : clockEnd + 1000 + delay;
    const presetId = intAttr(ctn, 'presetID') ?? 1;
    const effect = presetId === 1 ? null : (ENTRANCE_EFFECTS[presetId] ?? 'fade');
    out.set(spid, {
      startMs: Math.round(start),
      effect,
      direction:
        effect === 'fly' || effect === 'wipe' ? DIRECTIONS[intAttr(ctn, 'presetSubtype') ?? 8] : undefined,
      durationMs,
    });
    prevStart = start;
    prevEnd = start + durationMs;
    clockEnd = Math.max(clockEnd, prevEnd);
  }
  return out;
}

function applyAnimations(
  elements: Json[],
  animations: Map<string, Animation>,
  ids: Map<string, string>,
): number {
  const byElement = new Map<string, Animation>();
  for (const [spid, anim] of animations) {
    const id = ids.get(spid);
    if (id) byElement.set(id, anim);
  }
  let end = 0;
  const visit = (list: Json[]) => {
    for (const el of list) {
      const anim = byElement.get(String(el['id']));
      if (anim) {
        el['timing'] = { startMs: anim.startMs };
        if (anim.effect)
          el['entrance'] = {
            effect: anim.effect,
            ...(anim.direction ? { direction: anim.direction } : {}),
            durationMs: anim.durationMs,
          };
        end = Math.max(end, anim.startMs + anim.durationMs);
      }
      if (Array.isArray(el['children'])) visit(el['children'] as Json[]);
    }
  };
  visit(elements);
  return end;
}

function backgroundOf(part: Part | undefined, ctx: SlideContext): Json | null {
  const bg = path(part?.root, [NS.p, 'cSld'], [NS.p, 'bg']);
  if (!bg) return null;
  const bgPr = child(bg, NS.p, 'bgPr');
  if (bgPr) {
    const blip = path(bgPr, [NS.a, 'blipFill'], [NS.a, 'blip']);
    const rel = blip && part ? part.rels.get(attr(blip, 'embed', NS.r) ?? '') : undefined;
    if (rel && !rel.external && RASTER_EXT.has(posix.extname(rel.target).slice(1).toLowerCase())) {
      const key = `pending:${ctx.images.length}`;
      ctx.images.push({ key, part: rel.target });
      return { image: { $asset: key } };
    }
    const color = resolveFill(child(bgPr, NS.a, 'solidFill') ?? child(bgPr, NS.a, 'gradFill'), ctx.colors);
    return color ? { color: color.slice(0, 7) } : null;
  }
  const ref = child(bg, NS.p, 'bgRef');
  const color = children(ref, NS.a).find((c) => (c.localName ?? '').endsWith('Clr'));
  const hex = color ? resolveColorElement(color, ctx.colors) : undefined;
  return hex ? { color: hex.slice(0, 7) } : null;
}

async function notesOf(slide: Part, ctx: SlideContext): Promise<Json | null> {
  const notes = await ctx.reader.related(slide, REL_TYPE.notesSlide);
  if (!notes) return null;
  const body = descendants(notes.root, NS.p, 'sp').find((sp) => placeholderOf(sp)?.type === 'body');
  if (!body) return null;
  const text = convertText(
    child(body, NS.p, 'txBody'),
    [body],
    { ...ctx, slide: notes, layout: undefined, master: undefined },
    'other',
    undefined,
    false,
  );
  return text.hasText ? { [ctx.lang]: text.doc } : null;
}

function sections(presentation: Element): Map<string, string> {
  const out = new Map<string, string>();
  for (const section of descendants(presentation, P14, 'section')) {
    const name = attr(section, 'name') ?? '';
    for (const sld of descendants(section, P14, 'sldId')) {
      const id = attr(sld, 'id');
      if (id) out.set(id, name);
    }
  }
  return out;
}

async function presentationTitle(reader: Reader, fallback: string): Promise<string> {
  if (!reader.has('docProps/core.xml')) return fallback;
  try {
    const core = await reader.xml('docProps/core.xml');
    const title = core.getElementsByTagNameNS(DC, 'title').item(0)?.textContent?.trim();
    return title ? title.slice(0, 200) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Reads a PPTX (OOXML presentation) into course slide nodes. Pure data
 * transformation: nothing in the file is executed, macro-enabled files are
 * refused, and pictures are only collected here (stored after sanitising).
 */
export async function parsePresentation(
  zip: ZipArchive,
  options: { lang: string; fileTitle: string; canvasHeight?: number },
): Promise<ParsedPresentation> {
  const reader = new Reader(zip);
  if (!reader.has('[Content_Types].xml')) throw invalid('Not a presentation file');
  const types = await reader.xml('[Content_Types].xml');
  const overrides = children(types.documentElement, NS.ct, 'Override');
  if (
    overrides.some((o) => (attr(o, 'ContentType') ?? '').includes('macroEnabled')) ||
    zip.names().some((n) => /vbaProject\.bin$/i.test(n))
  )
    throw new AppError('unsupported_media_type', 'Presentations with macros are not accepted');
  const rootRels = await reader.rels('');
  const mainRel = [...rootRels.values()].find((r) => r.type.endsWith(REL_TYPE.officeDocument));
  const mainType = overrides.find((o) => attr(o, 'PartName') === `/${mainRel?.target ?? ''}`);
  if (!mainRel || !MAIN_TYPES.has(attr(mainType, 'ContentType') ?? ''))
    throw new AppError('unsupported_media_type', 'Not a PPTX presentation');

  const presentation = await reader.part(mainRel.target);
  const size = child(presentation.root, NS.p, 'sldSz');
  const cx = intAttr(size, 'cx') ?? 12_192_000;
  const cy = intAttr(size, 'cy') ?? 6_858_000;
  if (cx <= 0 || cy <= 0) throw invalid('Invalid slide size');
  const height = options.canvasHeight ?? 720;
  const width = Math.min(3840, Math.max(320, Math.round((height * cx) / cy)));
  const scale = height / cy;
  const transform: Transform = { ox: 0, oy: 0, cx: 0, cy: 0, sx: scale, sy: scale };

  const sldIds = children(child(presentation.root, NS.p, 'sldIdLst'), NS.p, 'sldId');
  if (!sldIds.length) throw invalid('The presentation has no slides');
  if (sldIds.length > MAX_SLIDES) throw invalid(`More than ${MAX_SLIDES} slides`);
  const sectionOf = sections(presentation.root);

  const images: PendingImage[] = [];
  const warnings: ImportWarning[] = [];
  const slides: ParsedSlide[] = [];
  const chapters: { title: string; slideIds: string[] }[] = [];
  const defaultChapter = options.lang.startsWith('de') ? 'Kapitel 1' : 'Chapter 1';

  for (const [index, sldId] of sldIds.entries()) {
    const rel = presentation.rels.get(attr(sldId, 'id', NS.r) ?? '');
    if (!rel || rel.external) continue;
    const slide = await reader.part(rel.target);
    if (attr(slide.root, 'show') === '0') continue;
    const layout = await reader.related(slide, REL_TYPE.slideLayout);
    const master = layout ? await reader.related(layout, REL_TYPE.slideMaster) : undefined;
    const theme = master ? await reader.related(master, REL_TYPE.theme) : undefined;
    const clrMapEl = child(master?.root, NS.p, 'clrMap');
    const map: Record<string, string> = {};
    for (const key of ['bg1', 'tx1', 'bg2', 'tx2']) {
      const v = attr(clrMapEl, key);
      if (v) map[key] = v;
    }
    const ctx: SlideContext = {
      reader,
      slide,
      layout,
      master,
      colors: { scheme: themeScheme(theme?.root ?? null), map },
      scale,
      lang: options.lang,
      images,
      warnings: new Set(),
      ids: new Map(),
    };

    const tree = path(slide.root, [NS.p, 'cSld'], [NS.p, 'spTree']);
    let elements = tree ? convertTree(tree, transform, ctx) : [];
    if (elements.length > MAX_ELEMENTS) {
      elements = elements.slice(0, MAX_ELEMENTS);
      ctx.warnings.add('too_many_elements');
    }
    const endMs = applyAnimations(elements, readAnimations(slide.root), ctx.ids);
    const background = backgroundOf(slide, ctx) ?? backgroundOf(layout, ctx) ?? backgroundOf(master, ctx);
    const titleSp = descendants(slide.root, NS.p, 'sp').find((sp) => placeholderOf(sp)?.type === 'title');
    const number = slides.length + 1;
    const title =
      textOf(titleSp).replace(/\s+/g, ' ').trim().slice(0, 200) ||
      (options.lang.startsWith('de') ? `Folie ${number}` : `Slide ${number}`);
    const notes = await notesOf(slide, ctx);
    const id = newId('s');
    slides.push({
      index,
      lossy: ctx.warnings.size > 0,
      node: {
        kind: 'slide',
        id,
        title: { [options.lang]: title },
        background: background ?? {},
        elements,
        ...(notes ? { notes } : {}),
        ...(endMs > 0 ? { durationMs: endMs + 1000 } : {}),
      },
    });
    for (const code of ctx.warnings) warnings.push({ code, slide: number });

    const sectionName =
      sectionOf.get(attr(sldId, 'id') ?? '') ?? (chapters.length ? undefined : defaultChapter);
    const last = chapters.at(-1);
    if (!last || (sectionName !== undefined && sectionName !== last.title))
      chapters.push({ title: (sectionName || defaultChapter).slice(0, 200), slideIds: [id] });
    else last.slideIds.push(id);
  }
  if (!slides.length) throw invalid('The presentation has no visible slides');

  return {
    title: await presentationTitle(reader, options.fileTitle),
    canvas: { width, height },
    chapters,
    slides,
    images,
    warnings,
    totalSlides: sldIds.length,
  };
}
