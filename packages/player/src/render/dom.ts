// SPDX-License-Identifier: Apache-2.0
/** Minimal DOM helper. Text is always set via textContent; there is no HTML path. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; attrs?: Record<string, string>; text?: string } = {},
  children: (Node | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  if (props.text !== undefined) el.textContent = props.text;
  for (const child of children) if (child) el.append(child);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Children without the placeholders of optional parts. */
export function present(...nodes: (Node | null | undefined)[]): Node[] {
  return nodes.filter((n): n is Node => !!n);
}
