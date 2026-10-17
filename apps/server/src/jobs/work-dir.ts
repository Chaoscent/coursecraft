// SPDX-License-Identifier: Apache-2.0
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/;

/**
 * Exchange directory with the converter (`work` volume). Everything the
 * converter writes is untrusted: names are checked against a pattern, files
 * are opened without following symlinks, and sizes are capped.
 */
export class WorkDir {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #dir(jobId: string): string {
    if (!JOB_ID.test(jobId)) throw new Error('Invalid job id');
    return join(this.#root, jobId);
  }

  /** Creates `<id>/in` and `<id>/out` (group-writable for the converter) and writes the input. */
  prepare(jobId: string, inputName: string, bytes: Buffer): void {
    if (!FILE_NAME.test(inputName)) throw new Error('Invalid input name');
    const dir = this.#dir(jobId);
    mkdirSync(join(dir, 'in'), { recursive: true });
    mkdirSync(join(dir, 'out'), { recursive: true });
    writeFileSync(join(dir, 'in', inputName), bytes, { mode: 0o640 });
    // Explicit modes (the umask would drop group write): the converter shares
    // only the group, may read the input and write outputs.
    chmodSync(dir, 0o2750);
    chmodSync(join(dir, 'in'), 0o2750);
    chmodSync(join(dir, 'out'), 0o2770);
  }

  outputs(jobId: string): string[] {
    try {
      return readdirSync(join(this.#dir(jobId), 'out'))
        .filter((n) => FILE_NAME.test(n))
        .sort();
    } catch {
      return [];
    }
  }

  /** Reads one output file; null when missing, not a regular file, or larger than `maxBytes`. */
  readOutput(jobId: string, name: string, maxBytes: number): Buffer | null {
    if (!FILE_NAME.test(name)) return null;
    let fd: number;
    try {
      fd = openSync(join(this.#dir(jobId), 'out', name), constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      return null;
    }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > maxBytes) return null;
      const buffer = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < stat.size) {
        const n = readSync(fd, buffer, offset, stat.size - offset, offset);
        if (n === 0) break;
        offset += n;
      }
      return buffer.subarray(0, offset);
    } finally {
      closeSync(fd);
    }
  }

  remove(jobId: string): void {
    rmSync(this.#dir(jobId), { recursive: true, force: true });
  }
}
