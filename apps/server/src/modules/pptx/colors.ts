// SPDX-License-Identifier: Apache-2.0
import { attr, children, intAttr, NS, type Element } from './xml.js';

/** Theme colour scheme (dk1, lt1, accent1 …) plus the master's colour map (tx1 → dk1 …). */
export interface ColorContext {
  scheme: Record<string, string>;
  map: Record<string, string>;
  /** Colour substituted for `phClr` (style references). */
  placeholder?: string;
}

const PRESET: Record<string, string> = {
  black: '000000',
  white: 'ffffff',
  red: 'ff0000',
  green: '008000',
  blue: '0000ff',
  yellow: 'ffff00',
  gray: '808080',
  grey: '808080',
  orange: 'ffa500',
};

const DEFAULT_MAP: Record<string, string> = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (v: number) =>
  Math.round(Math.min(255, Math.max(0, v)))
    .toString(16)
    .padStart(2, '0');

function rgbToHsl([r, g, b]: Rgb): Rgb {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]: Rgb): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p: number, q: number, t: number) => {
    const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

function baseHex(el: Element, ctx: ColorContext): string | undefined {
  switch (el.localName) {
    case 'srgbClr':
      return attr(el, 'val')?.toLowerCase();
    case 'sysClr':
      return attr(el, 'lastClr')?.toLowerCase();
    case 'prstClr':
      return PRESET[attr(el, 'val') ?? ''];
    case 'scrgbClr': {
      const c = ['r', 'g', 'b'].map((k) => ((intAttr(el, k) ?? 0) / 100_000) * 255);
      return c.map(toHex).join('');
    }
    case 'schemeClr': {
      const val = attr(el, 'val') ?? '';
      if (val === 'phClr') return ctx.placeholder?.slice(1, 7);
      const mapped = ctx.map[val] ?? DEFAULT_MAP[val] ?? val;
      return ctx.scheme[mapped];
    }
    default:
      return undefined;
  }
}

/** Resolves one DrawingML colour element (srgbClr, schemeClr …) with its transforms. */
export function resolveColorElement(el: Element, ctx: ColorContext): string | undefined {
  const hex = baseHex(el, ctx);
  if (!hex || !/^[0-9a-f]{6}$/.test(hex)) return undefined;
  let rgb = hexToRgb(hex);
  let alpha = 1;
  for (const t of children(el, NS.a)) {
    const v = (intAttr(t, 'val') ?? 0) / 100_000;
    switch (t.localName) {
      case 'lumMod': {
        const [h, s, l] = rgbToHsl(rgb);
        rgb = hslToRgb([h, s, Math.min(1, l * v)]);
        break;
      }
      case 'lumOff': {
        const [h, s, l] = rgbToHsl(rgb);
        rgb = hslToRgb([h, s, Math.min(1, Math.max(0, l + v))]);
        break;
      }
      case 'tint':
        rgb = rgb.map((c) => c + (255 - c) * (1 - v)) as Rgb;
        break;
      case 'shade':
        rgb = rgb.map((c) => c * v) as Rgb;
        break;
      case 'alpha':
        alpha = v;
        break;
    }
  }
  const out = `#${rgb.map(toHex).join('')}`;
  return alpha < 0.999 ? `${out}${toHex(alpha * 255)}` : out;
}

/** Colour of a fill container (`a:solidFill`, `a:gradFill` first stop, or a bare colour parent). */
export function resolveFill(fill: Element | null, ctx: ColorContext): string | undefined {
  if (!fill) return undefined;
  if (fill.localName === 'gradFill') {
    const stop = children(children(fill, NS.a, 'gsLst')[0], NS.a, 'gs')[0];
    return stop ? resolveFill(stop, ctx) : undefined;
  }
  const color = children(fill, NS.a).find((c) => (c.localName ?? '').endsWith('Clr'));
  return color ? resolveColorElement(color, ctx) : undefined;
}

/** Reads `a:clrScheme` from a theme part. */
export function themeScheme(theme: Element | null): Record<string, string> {
  const scheme: Record<string, string> = {};
  const clrScheme = theme?.getElementsByTagNameNS(NS.a, 'clrScheme').item(0);
  for (const entry of children(clrScheme ?? null, NS.a)) {
    const color = children(entry, NS.a)[0];
    const hex = color ? baseHex(color, { scheme: {}, map: {} }) : undefined;
    if (hex && entry.localName) scheme[entry.localName] = hex;
  }
  return scheme;
}
