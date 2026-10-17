// SPDX-License-Identifier: Apache-2.0
import { DOMParser, type Document, type Element } from '@xmldom/xmldom';
import { AppError } from '../../http/errors.js';

export const NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
} as const;

const invalid = (message: string) => new AppError('invalid_file', message);

/**
 * Parses an XML part. Documents with a DTD are refused before parsing:
 * OOXML never needs one, and it is the vector for entity expansion attacks.
 */
export function parseXml(bytes: Buffer): Document {
  const text = bytes.toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw invalid('XML with a document type is not accepted');
  try {
    const doc = new DOMParser({
      onError: (level, message) => {
        if (level !== 'warning') throw new Error(message);
      },
    }).parseFromString(text, 'application/xml');
    if (!doc.documentElement) throw new Error('empty');
    return doc;
  } catch {
    throw invalid('Damaged XML in the presentation');
  }
}

export function children(el: Element | null | undefined, ns: string, name?: string): Element[] {
  const out: Element[] = [];
  if (!el) return out;
  for (let node = el.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 1) continue;
    const child = node as Element;
    if (child.namespaceURI === ns && (name === undefined || child.localName === name)) out.push(child);
  }
  return out;
}

export function child(el: Element | null | undefined, ns: string, name: string): Element | null {
  return children(el, ns, name)[0] ?? null;
}

/** Follows a chain of child elements, e.g. `path(sp, [NS.p, 'spPr'], [NS.a, 'xfrm'])`. */
export function path(el: Element | null | undefined, ...steps: [string, string][]): Element | null {
  let current: Element | null = el ?? null;
  for (const [ns, name] of steps) current = child(current, ns, name);
  return current;
}

export function descendants(el: Element | null | undefined, ns: string, name: string): Element[] {
  if (!el) return [];
  const list = el.getElementsByTagNameNS(ns, name);
  const out: Element[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list.item(i);
    if (item) out.push(item);
  }
  return out;
}

export function attr(el: Element | null | undefined, name: string, ns?: string): string | undefined {
  if (!el) return undefined;
  const value = ns ? el.getAttributeNS(ns, name) : el.getAttribute(name);
  return value === null || value === '' ? undefined : value;
}

export function intAttr(el: Element | null | undefined, name: string): number | undefined {
  const value = attr(el, name);
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

export type { Document, Element };
