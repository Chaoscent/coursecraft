// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { assertKey, BlobNotFound, FsBlobStore } from './index.js';
import { authorization } from './sigv4.js';

const root = mkdtempSync(join(tmpdir(), 'cc-blob-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const text = async (stream: Readable): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString();
};

describe('storage keys', () => {
  it('refuses anything that could leave the root', () => {
    for (const bad of ['', '/a', 'a/', 'a//b', 'a/../b', '../a', 'a/./b', 'a\\b', 'a\0b'])
      expect(() => assertKey(bad), bad).toThrow();
    expect(() => assertKey('packages/1f/dir with space/ü.html')).not.toThrow();
  });
});

describe('file system store', () => {
  const store = new FsBlobStore(join(root, 'data'));

  it('writes atomically, reads ranges and reports sizes', async () => {
    await store.put('a/b/file.txt', Buffer.from('0123456789'));
    expect(await store.stat('a/b/file.txt')).toEqual({ size: 10 });
    expect(await text(await store.read('a/b/file.txt', { start: 2, end: 5 }))).toBe('2345');
    await store.put('a/b/streamed.txt', {
      stream: Readable.from([Buffer.from('ab'), Buffer.from('cd')]),
      size: 4,
    });
    expect((await store.readAll('a/b/streamed.txt', 10))?.toString()).toBe('abcd');
    expect(await store.readAll('a/b/streamed.txt', 3)).toBeNull();
    expect(await store.list('a/b')).toEqual(['file.txt', 'streamed.txt']);
  });

  it('answers missing objects and removes prefixes', async () => {
    expect(await store.stat('nope')).toBeNull();
    await expect(store.read('nope')).rejects.toBeInstanceOf(BlobNotFound);
    await store.removePrefix('a');
    expect(await store.stat('a/b/file.txt')).toBeNull();
    expect(await store.list('a/b')).toEqual([]);
  });

  it('does not follow symbolic links', async () => {
    writeFileSync(join(root, 'secret.txt'), 'outside');
    await store.put('real.txt', Buffer.from('inside'));
    symlinkSync(join(root, 'secret.txt'), join(root, 'data', 'link.txt'));
    expect(await store.stat('link.txt')).toBeNull();
    await expect(store.read('link.txt')).rejects.toBeInstanceOf(BlobNotFound);
    expect(await store.readAll('link.txt', 100)).toBeNull();
  });
});

describe('Signature V4', () => {
  // Example "GET Object" with a Range header from the AWS documentation.
  it('matches the documented signature', () => {
    const header = authorization({
      method: 'GET',
      path: '/test.txt',
      query: {},
      headers: {
        host: 'examplebucket.s3.amazonaws.com',
        range: 'bytes=0-9',
        'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'x-amz-date': '20130524T000000Z',
      },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      region: 'us-east-1',
      service: 's3',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      amzDate: '20130524T000000Z',
    });
    expect(header).toContain('Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request');
    expect(header).toContain('SignedHeaders=host;range;x-amz-content-sha256;x-amz-date');
    expect(header).toContain('Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });
});
