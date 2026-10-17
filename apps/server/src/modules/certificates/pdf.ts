// SPDX-License-Identifier: Apache-2.0
/**
 * Minimal single-page PDF writer for certificates: standard Helvetica fonts
 * (no embedding, no compression, no external data), text and lines only.
 * Characters outside WinAnsi are replaced by "?".
 */

/** Helvetica advance widths (1/1000 em) for ASCII 32..126; other characters use an average. */
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278,
  500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469,
  556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
  278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const BOLD_FACTOR = 1.06;

/** Typographic characters of WinAnsi (0x80–0x9F) that are not in Latin-1. */
const WIN_ANSI: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

function winAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text.normalize('NFC')) {
    const cp = ch.codePointAt(0) ?? 63;
    if (cp === 10 || cp === 13 || cp === 9) out.push(32);
    else if (cp >= 32 && cp < 127) out.push(cp);
    else if (cp >= 0xa0 && cp <= 0xff) out.push(cp);
    else out.push(WIN_ANSI[cp] ?? 63);
  }
  return out;
}

export function textWidth(text: string, size: number, bold = false): number {
  let units = 0;
  for (const b of winAnsi(text)) units += b >= 32 && b < 127 ? (WIDTHS[b - 32] ?? 556) : 556;
  return ((units * size) / 1000) * (bold ? BOLD_FACTOR : 1);
}

const num = (n: number) => (Math.round(n * 100) / 100).toString();

/** Hex string: no escaping problems with parentheses, backslashes or control bytes. */
const hexString = (bytes: number[]) => `<${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}>`;

export interface PdfText {
  text: string;
  size: number;
  bold?: boolean;
  /** Distance of the baseline from the page bottom. */
  y: number;
  /** Left edge; omitted = centered on the page. */
  x?: number;
  color?: [number, number, number];
}

export interface PdfLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  color: [number, number, number];
}

export interface PdfPage {
  width: number;
  height: number;
  texts: PdfText[];
  lines: PdfLine[];
  title: string;
}

export function renderPdf(page: PdfPage): Buffer {
  const content: string[] = [];
  for (const l of page.lines) {
    content.push(
      `${l.color.join(' ')} RG ${num(l.width)} w ${num(l.x1)} ${num(l.y1)} m ${num(l.x2)} ${num(l.y2)} l S`,
    );
  }
  for (const t of page.texts) {
    const x = t.x ?? (page.width - textWidth(t.text, t.size, t.bold)) / 2;
    const color = t.color ?? [0, 0, 0];
    content.push(
      `BT /${t.bold ? 'F2' : 'F1'} ${num(t.size)} Tf ${color.join(' ')} rg ${num(x)} ${num(t.y)} Td ${hexString(winAnsi(t.text))} Tj ET`,
    );
  }
  const stream = content.join('\n');
  const info = hexString([
    0xfe,
    0xff,
    ...[...page.title].flatMap((c) => [(c.charCodeAt(0) >> 8) & 255, c.charCodeAt(0) & 255]),
  ]);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    `<< /Title ${info} /Producer (Coursecraft) >>`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${o.toString().padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
