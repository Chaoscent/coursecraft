// SPDX-License-Identifier: Apache-2.0
import {
  createReadStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type ReadStream,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';

export { ASSET_EXTENSIONS as EXTENSIONS } from '@lernwerk/course-model';

/**
 * Content-addressed file storage outside any served directory:
 * `<data>/assets/<sha[0:2]>/<sha>`. Identical files are stored once.
 */
export class AssetStore {
  readonly #root: string;

  constructor(dataDir: string) {
    this.#root = join(dataDir, 'assets');
    mkdirSync(join(dataDir, 'tmp'), { recursive: true });
  }

  pathFor(sha256: string): string {
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid asset hash');
    return join(this.#root, sha256.slice(0, 2), sha256);
  }

  has(sha256: string): boolean {
    return existsSync(this.pathFor(sha256));
  }

  size(sha256: string): number {
    return statSync(this.pathFor(sha256)).size;
  }

  /** Stores bytes; returns the hash. Writes atomically via a temporary file. */
  put(bytes: Buffer): string {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const target = this.pathFor(sha256);
    if (existsSync(target)) return sha256;
    mkdirSync(join(this.#root, sha256.slice(0, 2)), { recursive: true });
    const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      writeFileSync(tmp, bytes, { mode: 0o640 });
      renameSync(tmp, target);
    } finally {
      rmSync(tmp, { force: true });
    }
    return sha256;
  }

  open(sha256: string, range?: { start: number; end: number }): ReadStream {
    return createReadStream(this.pathFor(sha256), range);
  }
}
