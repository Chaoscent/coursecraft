// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import yauzl from 'yauzl';
import { columnName, writeXlsx } from './xlsx.js';

function entries(buffer: Buffer): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const files = new Map<string, string>();
      zip.on('entry', (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (err, stream) => {
          if (err) return reject(err);
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks).toString('utf8'));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(files));
      zip.readEntry();
    });
  });
}

describe('xlsx', () => {
  it('names columns like spreadsheets do', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });

  it('writes a workbook with header, text and numbers, and never formulas', async () => {
    const files = await entries(
      await writeXlsx(
        'Bericht: Kurs',
        ['Name', 'Score'],
        [
          ['Anna <Admin> & Co', 80],
          ['=HYPERLINK("http://evil","x")', null],
        ],
      ),
    );
    expect([...files.keys()].sort()).toEqual(
      [
        '[Content_Types].xml',
        '_rels/.rels',
        'xl/_rels/workbook.xml.rels',
        'xl/styles.xml',
        'xl/workbook.xml',
        'xl/worksheets/sheet1.xml',
      ].sort(),
    );
    const sheet = files.get('xl/worksheets/sheet1.xml') ?? '';
    expect(sheet).toContain(
      '<c r="A2" s="0" t="inlineStr"><is><t xml:space="preserve">Anna &lt;Admin&gt; &amp; Co</t></is></c>',
    );
    expect(sheet).toContain('<c r="B2" s="0"><v>80</v></c>');
    expect(sheet).not.toContain('<f>');
    expect(sheet).toContain('=HYPERLINK(&quot;http://evil&quot;,&quot;x&quot;)');
    expect(files.get('xl/workbook.xml')).toContain('name="Bericht  Kurs"');
  });
});
