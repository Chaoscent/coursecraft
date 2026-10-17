// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  body,
  buildPptx,
  group,
  para,
  picture,
  shape,
  table,
  textBox,
  timing,
  title,
  type PresentationSpec,
} from '../../../../../tests/support/pptx.js';
import { solidPng } from '../../../../../tests/support/png.js';
import { ZipArchive } from '../../lib/zip.js';
import { PPTX_LIMITS } from './import.js';
import { parsePresentation } from './parse.js';

type Json = Record<string, unknown>;

async function parse(spec: PresentationSpec) {
  const zip = await ZipArchive.open(await buildPptx(spec), PPTX_LIMITS);
  try {
    return await parsePresentation(zip, { lang: 'de', fileTitle: 'Datei' });
  } finally {
    zip.close();
  }
}

const elements = (slide: { node: Json }) => slide.node['elements'] as Json[];

describe('parsePresentation', () => {
  it('reads slides, titles, placeholders with inherited position, bullets and notes', async () => {
    const result = await parse({
      title: 'Brandschutz',
      slides: [
        {
          shapes: [
            title(2, 'Einführung'),
            body(3, [
              para(['Erster Punkt']),
              para(['Zweiter ', { text: 'fett', bold: true }]),
              para(['Ohne'], { bullet: false }),
            ]),
          ],
          notes: 'Sprechertext',
        },
      ],
    });
    expect(result.title).toBe('Brandschutz');
    expect(result.canvas).toEqual({ width: 1280, height: 720 });
    expect(result.totalSlides).toBe(1);
    const [slide] = result.slides;
    expect(slide?.node['title']).toEqual({ de: 'Einführung' });
    const [heading, content] = elements(slide!);
    // Position comes from the master placeholder (838200 EMU = 88 px).
    expect(heading?.['frame']).toMatchObject({ x: 88, y: 38.33 });
    expect(heading?.['style']).toMatchObject({ sizePx: 58.67, verticalAlign: 'middle', color: '#1f2937' });
    const doc = (content?.['content'] as Record<string, { content: Json[] }>)['de'];
    expect(doc?.content[0]).toMatchObject({ type: 'bulletList' });
    expect((doc?.content[0]?.['content'] as Json[]).length).toBe(2);
    expect(JSON.stringify(doc?.content[0])).toContain('"bold"');
    expect(doc?.content[1]).toMatchObject({ type: 'paragraph' });
    expect(JSON.stringify(slide?.node['notes'])).toContain('Sprechertext');
  });

  it('converts text boxes, shapes with theme colours, lines, links and alt text', async () => {
    const result = await parse({
      slides: [
        {
          shapes: [
            textBox(
              4,
              { x: 100, y: 100, w: 400, h: 80 },
              [para([{ text: 'Rot', color: 'FF0000', sizePt: 24, link: 'rId5' }], { align: 'ctr' })],
              'ctr',
            ),
            shape(
              5,
              'ellipse',
              { x: 600, y: 100, w: 200, h: 200 },
              { scheme: 'accent1', text: [para(['Kreis'])], descr: 'Ein Kreis' },
            ),
            shape(6, 'line', { x: 0, y: 400, w: 300, h: 0 }, { line: '00FF00' }),
            shape(7, 'cloud', { x: 900, y: 500, w: 100, h: 100 }, { fill: '123456' }),
          ],
          links: { rId5: 'https://example.org/info' },
        },
      ],
    });
    const [text, circle, line, cloud] = elements(result.slides[0]!);
    expect(text).toMatchObject({ type: 'text', frame: { x: 100, y: 100, width: 400, height: 80 } });
    expect(text?.['style']).toMatchObject({ sizePx: 32, verticalAlign: 'middle' });
    const json = JSON.stringify(text?.['content']);
    expect(json).toContain('"align":"center"');
    expect(json).toContain('"href":"https://example.org/info"');
    expect(json).toContain('"color":"#ff0000"');
    // accent1 2563EB with lumMod 75 % is darker.
    expect(circle).toMatchObject({ type: 'shape', shape: 'ellipse', altText: { de: 'Ein Kreis' } });
    expect(circle?.['fill']).toMatch(/^#[0-9a-f]{6}$/);
    expect(circle?.['fill']).not.toBe('#2563eb');
    expect(line).toMatchObject({ type: 'shape', shape: 'line', stroke: { color: '#00ff00' } });
    expect((line?.['frame'] as Json)['width']).toBe(300);
    expect(cloud).toMatchObject({ shape: 'rectangle', fill: '#123456' });
    expect(result.warnings).toContainEqual({ code: 'unsupported_content', slide: 1 });
  });

  it('collects pictures with crop, maps groups to relative frames and flags tables', async () => {
    const image = solidPng(40, 20, [200, 200, 200]);
    const result = await parse({
      slides: [
        {
          shapes: [
            picture(8, 'rId7', { x: 10, y: 20, w: 200, h: 100 }, 'Foto', '<a:srcRect l="10000" r="10000"/>'),
            group(9, { x: 500, y: 300, w: 200, h: 200 }, { x: 0, y: 0, w: 100, h: 100 }, [
              shape(10, 'rect', { x: 50, y: 50, w: 50, h: 50 }, { fill: 'AABBCC' }),
            ]),
            table(11, { x: 0, y: 600, w: 400, h: 50 }),
          ],
          images: { rId7: { name: 'image1.png', bytes: image } },
        },
      ],
    });
    const [pic, grp] = elements(result.slides[0]!);
    expect(pic).toMatchObject({ type: 'image', image: { $asset: 'pending:0' }, altText: { de: 'Foto' } });
    expect(result.images[0]).toMatchObject({ part: 'ppt/media/image1.png', crop: { left: 0.1, right: 0.1 } });
    expect(grp).toMatchObject({ type: 'group', frame: { x: 500, y: 300, width: 200, height: 200 } });
    // Child at (50,50) in a 100-unit child space scaled ×2 → offset 100 inside the group.
    expect((grp?.['children'] as Json[])[0]?.['frame']).toMatchObject({
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });
    expect(result.slides[0]?.lossy).toBe(true);
  });

  it('turns entrance animations into timed steps', async () => {
    const result = await parse({
      slides: [
        {
          shapes: [
            textBox(2, { x: 0, y: 0, w: 100, h: 50 }, [para(['A'])]),
            textBox(3, { x: 0, y: 100, w: 100, h: 50 }, [para(['B'])]),
            textBox(4, { x: 0, y: 200, w: 100, h: 50 }, [para(['C'])]),
          ],
          timing: timing([
            [2, 10, 'clickEffect'],
            [3, 2, 'withEffect'],
            [4, 10, 'afterEffect'],
          ]),
        },
      ],
    });
    const [a, b, c] = elements(result.slides[0]!);
    expect(a).toMatchObject({ timing: { startMs: 1000 }, entrance: { effect: 'fade', durationMs: 500 } });
    expect(b).toMatchObject({ timing: { startMs: 1000 }, entrance: { effect: 'fly', direction: 'down' } });
    expect(c).toMatchObject({ timing: { startMs: 1500 } });
    expect(result.slides[0]?.node['durationMs']).toBe(3000);
  });

  it('skips hidden slides but keeps their page position, and uses sections as chapters', async () => {
    const result = await parse({
      size: { cx: 9_144_000, cy: 6_858_000 },
      slides: [
        { shapes: [title(2, 'Eins')] },
        { shapes: [title(2, 'Versteckt')], hidden: true },
        { shapes: [title(2, 'Drei')] },
      ],
      sections: [
        { name: 'Teil A', slides: [1, 2] },
        { name: 'Teil B', slides: [3] },
      ],
    });
    expect(result.canvas).toEqual({ width: 960, height: 720 });
    expect(result.slides.map((s) => s.index)).toEqual([0, 2]);
    expect(result.chapters.map((c) => [c.title, c.slideIds.length])).toEqual([
      ['Teil A', 1],
      ['Teil B', 1],
    ]);
    expect(result.totalSlides).toBe(3);
  });

  it('refuses macro-enabled files, DTDs and non-presentations', async () => {
    await expect(parse({ slides: [{ shapes: [] }], macroEnabled: true })).rejects.toMatchObject({
      code: 'unsupported_media_type',
    });
    await expect(
      parse({ slides: [{ shapes: [] }], extraFiles: { 'ppt/vbaProject.bin': Buffer.from('x') } }),
    ).rejects.toMatchObject({ code: 'unsupported_media_type' });
    await expect(ZipArchive.open(Buffer.from('not a zip'), PPTX_LIMITS)).rejects.toMatchObject({
      code: 'invalid_file',
    });
  });
});
