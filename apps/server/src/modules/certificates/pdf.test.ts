// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { renderPdf, textWidth } from './pdf.js';

const page = (text: string) =>
  renderPdf({ width: 842, height: 595, title: 'Zertifikat', lines: [], texts: [{ text, size: 20, y: 300 }] });

describe('certificate PDF', () => {
  it('writes a well-formed file with a correct cross-reference table', () => {
    const pdf = page('Brandschutz');
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(7);
    entries.forEach((offset, i) =>
      expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`),
    );
    const length = Number(/\/Length (\d+)/.exec(text)?.[1]);
    const body = text.slice(text.indexOf('stream\n') + 7, text.indexOf('\nendstream'));
    expect(body).toHaveLength(length);
  });

  it('encodes umlauts and typographic quotes in WinAnsi and replaces the rest', () => {
    const hex =
      /Tj/.exec(page('Größe „x“ ł 😀').toString('latin1')) && page('Größe „x“ ł 😀').toString('latin1');
    // ö = f6, ß = df, „ = 84, “ = 93, ł and the emoji become "?" (3f)
    expect(hex).toContain('<4772f6df6520');
    expect(hex).toContain('84');
    expect(hex).toMatch(/3f/);
  });

  it('never lets text break out of the content stream', () => {
    const pdf = page(') Tj ET /Evil (').toString('latin1');
    expect(pdf).not.toContain('/Evil');
  });

  it('measures text so centered lines stay inside the page', () => {
    expect(textWidth('Coursecraft', 20)).toBeGreaterThan(80);
    expect(textWidth('Coursecraft', 20, true)).toBeGreaterThan(textWidth('Coursecraft', 20));
  });
});
