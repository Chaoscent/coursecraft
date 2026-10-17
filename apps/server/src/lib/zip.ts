// SPDX-License-Identifier: Apache-2.0
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { AppError } from '../http/errors.js';

export interface ZipLimits {
  maxEntries: number;
  /** Sum of all uncompressed sizes. */
  maxTotalBytes: number;
  maxEntryBytes: number;
  /** Uncompressed / compressed, checked for entries above 1 MB. */
  maxRatio: number;
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** Normalised entry path, or null when the path is unsafe. */
export function safeEntryPath(name: string): string | null {
  if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/')) return null;
  if (/^[a-zA-Z]:/.test(name)) return null;
  const parts = name.split('/');
  if (parts.some((p) => p === '..' || p === '.')) return null;
  return parts.filter(Boolean).join('/');
}

const invalid = (message: string) => new AppError('invalid_file', message);

/**
 * Read-only view of a ZIP archive held in memory. The central directory is
 * checked against the limits up front (entry count, sizes, compression
 * ratio, unsafe paths, symlinks); entry contents are inflated on demand,
 * and yauzl verifies the declared sizes while reading.
 */
export class ZipArchive {
  readonly #zip: yauzl.ZipFile;
  readonly #entries: Map<string, yauzl.Entry>;
  readonly #limits: ZipLimits;

  private constructor(zip: yauzl.ZipFile, entries: Map<string, yauzl.Entry>, limits: ZipLimits) {
    this.#zip = zip;
    this.#entries = entries;
    this.#limits = limits;
  }

  static open(buffer: Buffer, limits: ZipLimits): Promise<ZipArchive> {
    return new Promise((resolve, reject) => {
      yauzl.fromBuffer(
        buffer,
        { lazyEntries: true, autoClose: false, decodeStrings: true, strictFileNames: true },
        (error, zip) => {
          if (error) return reject(invalid('Not a valid ZIP file'));
          const entries = new Map<string, yauzl.Entry>();
          let total = 0;
          zip.on('error', () => reject(invalid('Corrupt ZIP file')));
          zip.on('entry', (entry: yauzl.Entry) => {
            if (entries.size >= limits.maxEntries) return reject(invalid('Too many files in archive'));
            const path = safeEntryPath(entry.fileName);
            if (path === null) return reject(invalid('Unsafe path in archive'));
            if (((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK)
              return reject(invalid('Symbolic links are not allowed'));
            if (!entry.fileName.endsWith('/')) {
              if (entry.uncompressedSize > limits.maxEntryBytes)
                return reject(invalid('File in archive too large'));
              total += entry.uncompressedSize;
              if (total > limits.maxTotalBytes) return reject(invalid('Archive content too large'));
              if (
                entry.uncompressedSize > 1024 * 1024 &&
                entry.uncompressedSize / Math.max(1, entry.compressedSize) > limits.maxRatio
              )
                return reject(invalid('Suspicious compression ratio'));
              if (entries.has(path)) return reject(invalid('Duplicate path in archive'));
              entries.set(path, entry);
            }
            zip.readEntry();
          });
          zip.on('end', () => resolve(new ZipArchive(zip, entries, limits)));
          zip.readEntry();
        },
      );
    });
  }

  has(path: string): boolean {
    return this.#entries.has(path);
  }

  names(): string[] {
    return [...this.#entries.keys()];
  }

  size(path: string): number {
    return this.#entries.get(path)?.uncompressedSize ?? 0;
  }

  read(path: string): Promise<Buffer> {
    const entry = this.#entries.get(path);
    if (!entry) return Promise.reject(invalid(`Missing file ${path}`));
    return new Promise((resolve, reject) => {
      this.#zip.openReadStream(entry, (error, stream) => {
        if (error) return reject(invalid('Corrupt ZIP entry'));
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > this.#limits.maxEntryBytes) {
            stream.destroy();
            reject(invalid('File in archive too large'));
          } else chunks.push(chunk);
        });
        stream.on('error', () => reject(invalid('Corrupt ZIP entry')));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
      });
    });
  }

  /**
   * Writes every entry below `dir`, streaming (large media never sit in
   * memory). Paths were validated when the archive was opened.
   */
  async extractTo(dir: string): Promise<number> {
    let total = 0;
    for (const [path, entry] of this.#entries) {
      const target = join(dir, path);
      await mkdir(dirname(target), { recursive: true });
      total += await new Promise<number>((resolve, reject) => {
        this.#zip.openReadStream(entry, (error, stream) => {
          if (error) return reject(invalid('Corrupt ZIP entry'));
          let size = 0;
          const out = createWriteStream(target, { flags: 'wx', mode: 0o640 });
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > this.#limits.maxEntryBytes) stream.destroy(invalid('File in archive too large'));
          });
          pipeline(stream, out)
            .then(() => resolve(size))
            .catch(() => reject(invalid('Corrupt ZIP entry')));
        });
      });
    }
    return total;
  }

  close(): void {
    this.#zip.close();
  }
}
