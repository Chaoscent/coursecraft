// SPDX-License-Identifier: Apache-2.0
/**
 * A minimal XLSX writer: one worksheet, a bold header row, text and number
 * cells. Strings are written as inline strings, never as formulas, so a value
 * like "=HYPERLINK(...)" stays plain text (no formula injection). Built on the
 * ZIP library already in use instead of a spreadsheet library with a large
 * dependency tree.
 */
import { ZipFile } from 'yazl';

export type Cell = string | number | null;

const escapeXml = (value: string): string =>
  value
    // Characters XML 1.0 does not allow at all.
    // eslint-disable-next-line no-control-regex -- removing control characters on purpose
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Column letters: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function cell(ref: string, value: Cell, style: number): string {
  if (value === null || value === '') return `<c r="${ref}" s="${style}"/>`;
  if (typeof value === 'number' && Number.isFinite(value))
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value).slice(0, 32_767))}</t></is></c>`;
}

function sheetXml(header: string[], rows: Cell[][]): string {
  const widths = header.map((h, i) =>
    Math.min(60, Math.max(h.length, ...rows.slice(0, 500).map((r) => String(r[i] ?? '').length)) + 2),
  );
  const lines = [header, ...rows].map(
    (row, r) =>
      `<row r="${r + 1}">${row.map((v, c) => cell(`${columnName(c)}${r + 1}`, v, r === 0 ? 1 : 0)).join('')}</row>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`,
    `<sheetData>${lines.join('')}</sheetData>`,
    rows.length ? `<autoFilter ref="A1:${columnName(header.length - 1)}${rows.length + 1}"/>` : '',
    '</worksheet>',
  ].join('');
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
const WORKBOOK_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
/** Style 0: normal; style 1: bold header. */
const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>';

/** One sheet named `sheetName` with `header` and `rows`, as an .xlsx file. */
export async function writeXlsx(sheetName: string, header: string[], rows: Cell[][]): Promise<Buffer> {
  const name = escapeXml(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const zip = new ZipFile();
  const fixed = { mtime: new Date(0) };
  zip.addBuffer(Buffer.from(CONTENT_TYPES), '[Content_Types].xml', fixed);
  zip.addBuffer(Buffer.from(ROOT_RELS), '_rels/.rels', fixed);
  zip.addBuffer(Buffer.from(workbook), 'xl/workbook.xml', fixed);
  zip.addBuffer(Buffer.from(WORKBOOK_RELS), 'xl/_rels/workbook.xml.rels', fixed);
  zip.addBuffer(Buffer.from(STYLES), 'xl/styles.xml', fixed);
  zip.addBuffer(Buffer.from(sheetXml(header, rows)), 'xl/worksheets/sheet1.xml', fixed);
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
