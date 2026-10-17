// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import yazl from 'yazl';
import { safeEntryPath, ZipArchive, type ZipLimits } from './zip.js';

const LIMITS: ZipLimits = {
  maxEntries: 10,
  maxTotalBytes: 10 * 1024 * 1024,
  maxEntryBytes: 5 * 1024 * 1024,
  maxRatio: 50,
};

function zip(files: Record<string, Buffer>, options: Partial<yazl.Options> = {}): Promise<Buffer> {
  const z = new yazl.ZipFile();
  for (const [name, bytes] of Object.entries(files)) z.addBuffer(bytes, name, options);
  z.end();
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    z.outputStream.on('data', (c: Buffer) => chunks.push(c));
    z.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

describe('safeEntryPath', () => {
  it('rejects traversal, absolute and backslash paths', () => {
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'a\\b', 'C:/x', 'a/./b', ''])
      expect(safeEntryPath(bad)).toBeNull();
    expect(safeEntryPath('ppt/slides/slide1.xml')).toBe('ppt/slides/slide1.xml');
  });
});

describe('ZipArchive', () => {
  it('reads entries on demand', async () => {
    const archive = await ZipArchive.open(await zip({ 'a.txt': Buffer.from('hallo') }), LIMITS);
    expect(archive.names()).toEqual(['a.txt']);
    expect((await archive.read('a.txt')).toString()).toBe('hallo');
    archive.close();
  });

  it('refuses archives with too many entries', async () => {
    const files = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`f${i}`, Buffer.from('x')]));
    await expect(ZipArchive.open(await zip(files), LIMITS)).rejects.toThrow(/Too many/);
  });

  it('refuses highly compressed entries (zip bombs)', async () => {
    const bomb = await zip({ 'zeros.bin': Buffer.alloc(4 * 1024 * 1024) });
    await expect(ZipArchive.open(bomb, LIMITS)).rejects.toThrow(/compression ratio/);
  });

  it('refuses entries above the size limit', async () => {
    const big = await zip({ 'big.bin': Buffer.alloc(6 * 1024 * 1024) }, { compress: false });
    await expect(ZipArchive.open(big, LIMITS)).rejects.toThrow(/too large/);
  });
});
