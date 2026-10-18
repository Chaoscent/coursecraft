// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsBlobStore } from '@coursecraft/storage';
import { afterAll, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import { ZipArchive } from '../../lib/zip.js';
import { PACKAGE_LIMITS, PackageStore } from './packages.js';

const root = mkdtempSync(join(tmpdir(), 'cc-pkg-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function zip(files: Record<string, Buffer>): Promise<Buffer> {
  const z = new yazl.ZipFile();
  for (const [name, bytes] of Object.entries(files)) z.addBuffer(bytes, name);
  z.end();
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    z.outputStream.on('data', (c: Buffer) => chunks.push(c));
    z.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const ID = '0f1e2d3c-4b5a-4968-8776-655443322110';

describe('PackageStore', () => {
  const store = new PackageStore(new FsBlobStore(root));
  const big = Buffer.alloc(300_000, 'abcdefghij');

  it('stores every file byte for byte and serves ranges', async () => {
    const archive = await ZipArchive.open(
      await zip({
        'index.html': Buffer.from('<h1>Hallo</h1>'),
        'media/big file.bin': big,
        'empty.txt': Buffer.alloc(0),
      }),
      PACKAGE_LIMITS,
    );
    expect(await store.extract(ID, archive)).toBe(14 + big.length);
    archive.close();

    const html = await store.file(ID, 'index.html');
    expect(html).toMatchObject({ size: 14, type: 'text/html; charset=utf-8' });
    const chunks: Buffer[] = [];
    for await (const c of await html!.open()) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('<h1>Hallo</h1>');

    const media = await store.file(ID, encodeURIComponent('media/big file.bin').replaceAll('%2F', '/'));
    expect(media?.size).toBe(big.length);
    const part: Buffer[] = [];
    for await (const c of await media!.open({ start: 10, end: 19 })) part.push(c as Buffer);
    expect(Buffer.concat(part).toString()).toBe('abcdefghij');
    expect((await store.file(ID, 'empty.txt'))?.size).toBe(0);
  });

  it('answers unsafe or missing paths with null and removes the package', async () => {
    for (const bad of ['../x', '%2e%2e/x', 'media', 'nope.html', '/etc/passwd'])
      expect(await store.file(ID, bad), bad).toBeNull();
    await store.remove(ID);
    expect(await store.file(ID, 'index.html')).toBeNull();
  });
});
