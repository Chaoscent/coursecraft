// SPDX-License-Identifier: Apache-2.0
/** Writes a sample presentation for manual checks: `tsx tests/support/make-sample-pptx.ts out.pptx`. */
import { writeFileSync } from 'node:fs';
import { solidPng } from './png.js';
import { body, buildPptx, para, picture, shape, table, textBox, timing, title } from './pptx.js';

const image = solidPng(320, 180, [37, 99, 235]);

const pptx = await buildPptx({
  title: 'Brandschutz Grundlagen',
  slides: [
    {
      shapes: [
        title(2, 'Brandschutz im Büro'),
        body(3, [para(['Fluchtwege kennen']), para(['Feuerlöscher ', { text: 'prüfen', bold: true }])]),
      ],
      notes: 'Begrüßung und Überblick.',
    },
    {
      shapes: [
        title(2, 'Formen und Bild'),
        shape(
          4,
          'ellipse',
          { x: 100, y: 220, w: 240, h: 240 },
          { scheme: 'accent1', text: [para(['Kreis'])] },
        ),
        shape(
          5,
          'rect',
          { x: 400, y: 220, w: 300, h: 160 },
          { fill: 'F59E0B', line: '92400E', text: [para(['Rechteck'])] },
        ),
        picture(6, 'rId7', { x: 760, y: 220, w: 400, h: 225 }, 'Blaue Fläche'),
        textBox(8, { x: 100, y: 560, w: 1000, h: 60 }, [
          para([{ text: 'Erscheint später', color: 'B91C1C', sizePt: 24 }]),
        ]),
      ],
      images: { rId7: { name: 'image1.png', bytes: image } },
      timing: timing([[8, 10, 'clickEffect']]),
    },
    { shapes: [title(2, 'Tabelle'), table(3, { x: 100, y: 200, w: 600, h: 120 })] },
  ],
});
writeFileSync(process.argv[2] ?? 'sample.pptx', pptx);
