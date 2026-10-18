// SPDX-License-Identifier: Apache-2.0
// The S3 client against a real S3-compatible server (Scality CloudServer).
import { S3BlobStore, BlobNotFound } from '../../packages/storage/src/index.js';
import type { StartedTestContainer } from 'testcontainers';
import { startS3Server, type S3Info } from '../support/s3-server.js';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let container: StartedTestContainer;
let store: S3BlobStore;
let options: S3Info;

const text = async (stream: Readable): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString();
};

beforeAll(async () => {
  const server = await startS3Server();
  container = server.container;
  options = server.info;
  store = new S3BlobStore({ ...options, keyPrefix: 'tenant-a' });
}, 180_000);
afterAll(() => container?.stop());

describe('S3 object storage', () => {
  it('writes, stats, reads ranges and replaces objects', async () => {
    await store.put('assets/ab/abcdef', Buffer.from('0123456789'));
    expect(await store.stat('assets/ab/abcdef')).toEqual({ size: 10 });
    expect(await text(await store.read('assets/ab/abcdef'))).toBe('0123456789');
    expect(await text(await store.read('assets/ab/abcdef', { start: 3, end: 6 }))).toBe('3456');
    await store.put('assets/ab/abcdef', Buffer.from('new'));
    expect((await store.readAll('assets/ab/abcdef', 100))?.toString()).toBe('new');
    expect(await store.readAll('assets/ab/abcdef', 2)).toBeNull();
  });

  it('streams a body of known size and handles awkward names', async () => {
    const body = Buffer.alloc(3 * 1024 * 1024, 'x');
    await store.put('packages/p1/dir with space/ü & é (1).html', {
      stream: Readable.from([body.subarray(0, 1_000_000), body.subarray(1_000_000)]),
      size: body.length,
    });
    expect(await store.stat('packages/p1/dir with space/ü & é (1).html')).toEqual({ size: body.length });
    expect(
      (await store.readAll('packages/p1/dir with space/ü & é (1).html', body.length))?.equals(body),
    ).toBe(true);
  });

  it('answers missing objects', async () => {
    expect(await store.stat('nothing/here')).toBeNull();
    await expect(store.read('nothing/here')).rejects.toBeInstanceOf(BlobNotFound);
    expect(await store.readAll('nothing/here', 10)).toBeNull();
  });

  it('lists direct children and removes a prefix, also across more than one page', async () => {
    for (let i = 0; i < 5; i += 1) await store.put(`work/job-1/out/page-${i}.png`, Buffer.from(String(i)));
    await store.put('work/job-1/in/source.pptx', Buffer.from('in'));
    await store.put('work/job-10/out/other.png', Buffer.from('other'));
    expect(await store.list('work/job-1/out')).toEqual([
      'page-0.png',
      'page-1.png',
      'page-2.png',
      'page-3.png',
      'page-4.png',
    ]);
    await store.removePrefix('work/job-1');
    expect(await store.list('work/job-1/out')).toEqual([]);
    expect(await store.stat('work/job-1/in/source.pptx')).toBeNull();
    // A prefix is a directory, not a string prefix: the neighbour stays.
    expect(await store.stat('work/job-10/out/other.png')).toEqual({ size: 5 });
  });

  it('keeps installations that share a bucket apart', async () => {
    const other = new S3BlobStore({ ...options, keyPrefix: 'tenant-b' });
    expect(await other.stat('assets/ab/abcdef')).toBeNull();
  });

  it('refuses wrong credentials', async () => {
    const wrong = new S3BlobStore({ ...options, secretAccessKey: 'not-the-secret' });
    await expect(wrong.put('x/y', Buffer.from('1'))).rejects.toThrow(/403/);
  });
});
