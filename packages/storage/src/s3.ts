// SPDX-License-Identifier: Apache-2.0
import { Readable } from 'node:stream';
import { authorization, awsEncode, sha256Hex } from './sigv4.js';
import { assertKey, BlobNotFound, type BlobRange, type BlobSource, type BlobStore } from './types.js';

export interface S3Options {
  /** Service address, e.g. a MinIO or cloud endpoint. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Keys below this prefix only (lets several installations share a bucket). */
  keyPrefix?: string;
  /** `bucket.host` addressing instead of `host/bucket` (needed by some providers). */
  virtualHostedStyle?: boolean;
}

const META_TIMEOUT_MS = 30_000;
const TRANSFER_TIMEOUT_MS = 15 * 60_000;
const LIST_PAGE = 1000;
const DELETE_PARALLEL = 8;

const unescapeXml = (s: string): string =>
  s
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');

export class S3Error extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'S3Error';
    this.status = status;
  }
}

/** S3-compatible object storage over HTTP(S) with Signature V4; no SDK. */
export class S3BlobStore implements BlobStore {
  readonly #o: S3Options;
  readonly #endpoint: URL;
  readonly #prefix: string;

  constructor(options: S3Options) {
    this.#o = options;
    this.#endpoint = new URL(options.endpoint);
    this.#prefix = options.keyPrefix ? `${options.keyPrefix.replace(/^\/+|\/+$/g, '')}/` : '';
  }

  #target(key: string | null, query: Record<string, string> = {}) {
    const objectKey = key === null ? '' : `${this.#prefix}${key}`;
    const virtual = this.#o.virtualHostedStyle === true;
    const host = virtual ? `${this.#o.bucket}.${this.#endpoint.host}` : this.#endpoint.host;
    const base = this.#endpoint.pathname.replace(/\/+$/, '');
    const path = `${base}${virtual ? '' : `/${awsEncode(this.#o.bucket)}`}/${awsEncode(objectKey, true)}`;
    const search = Object.keys(query)
      .sort()
      .map((k) => `${awsEncode(k)}=${awsEncode(query[k] ?? '')}`)
      .join('&');
    return {
      host,
      path,
      query,
      url: `${this.#endpoint.protocol}//${host}${path}${search ? `?${search}` : ''}`,
    };
  }

  async #send(
    method: string,
    key: string | null,
    options: {
      query?: Record<string, string>;
      body?: Buffer | { stream: Readable; size: number };
      range?: BlobRange;
      timeoutMs?: number;
    } = {},
  ): Promise<Response> {
    const target = this.#target(key, options.query);
    const body = options.body;
    const payloadHash = Buffer.isBuffer(body) ? sha256Hex(body) : body ? 'UNSIGNED-PAYLOAD' : sha256Hex('');
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const signedHeaders: Record<string, string> = {
      host: target.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...(options.range ? { range: `bytes=${options.range.start}-${options.range.end}` } : {}),
    };
    // The length travels with the request but is not part of the signature.
    const headers: Record<string, string> = {
      ...signedHeaders,
      ...(body ? { 'content-length': String(Buffer.isBuffer(body) ? body.length : body.size) } : {}),
    };
    const auth = authorization({
      method,
      path: target.path,
      query: target.query,
      headers: signedHeaders,
      payloadHash,
      region: this.#o.region,
      service: 's3',
      accessKeyId: this.#o.accessKeyId,
      secretAccessKey: this.#o.secretAccessKey,
      amzDate,
    });
    const init: RequestInit = {
      method,
      headers: { ...headers, authorization: auth },
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? META_TIMEOUT_MS),
    };
    if (Buffer.isBuffer(body)) init.body = new Uint8Array(body);
    // Streams need the (Node-specific) duplex flag, which RequestInit does not declare.
    else if (body) Object.assign(init, { body: Readable.toWeb(body.stream), duplex: 'half' });
    return fetch(target.url, init);
  }

  async #fail(res: Response, what: string): Promise<never> {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    throw new S3Error(res.status, `${what}: ${res.status} ${text}`);
  }

  async stat(key: string): Promise<{ size: number } | null> {
    assertKey(key);
    const res = await this.#send('HEAD', key);
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) return this.#fail(res, `HEAD ${key}`);
    return { size: Number(res.headers.get('content-length') ?? 0) };
  }

  async read(key: string, range?: BlobRange): Promise<Readable> {
    assertKey(key);
    const res = await this.#send('GET', key, {
      timeoutMs: TRANSFER_TIMEOUT_MS,
      ...(range ? { range } : {}),
    });
    if (res.status === 404) throw new BlobNotFound(key);
    if (!res.ok || !res.body) return this.#fail(res, `GET ${key}`);
    return Readable.from(res.body);
  }

  async readAll(key: string, maxBytes: number): Promise<Buffer | null> {
    const stat = await this.stat(key);
    if (!stat || stat.size > maxBytes) return null;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of await this.read(key)) chunks.push(chunk as Buffer);
    } catch (error) {
      if (error instanceof BlobNotFound) return null;
      throw error;
    }
    return Buffer.concat(chunks);
  }

  async put(key: string, source: BlobSource): Promise<void> {
    assertKey(key);
    const res = await this.#send('PUT', key, { body: source, timeoutMs: TRANSFER_TIMEOUT_MS });
    if (!res.ok) await this.#fail(res, `PUT ${key}`);
    await res.arrayBuffer();
  }

  async remove(key: string): Promise<void> {
    assertKey(key);
    const res = await this.#send('DELETE', key);
    if (!res.ok && res.status !== 404) await this.#fail(res, `DELETE ${key}`);
    await res.arrayBuffer();
  }

  /** Every key below `prefix/` (recursive) or only its direct children. */
  async #listKeys(prefix: string, recursive: boolean): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const query: Record<string, string> = {
        'list-type': '2',
        prefix: `${this.#prefix}${prefix}/`,
        'max-keys': String(LIST_PAGE),
        ...(recursive ? {} : { delimiter: '/' }),
        ...(token ? { 'continuation-token': token } : {}),
      };
      const res = await this.#send('GET', null, { query });
      if (!res.ok) return this.#fail(res, `LIST ${prefix}`);
      const xml = await res.text();
      for (const match of xml.matchAll(/<Contents>[\s\S]*?<Key>([\s\S]*?)<\/Key>[\s\S]*?<\/Contents>/g))
        keys.push(unescapeXml(match[1] ?? '').slice(this.#prefix.length));
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        ? unescapeXml(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '')
        : undefined;
    } while (token);
    return keys;
  }

  async removePrefix(prefix: string): Promise<void> {
    assertKey(prefix);
    const keys = await this.#listKeys(prefix, true);
    for (let i = 0; i < keys.length; i += DELETE_PARALLEL)
      await Promise.all(keys.slice(i, i + DELETE_PARALLEL).map((k) => this.remove(k)));
  }

  async list(prefix: string): Promise<string[]> {
    assertKey(prefix);
    return (await this.#listKeys(prefix, false)).map((k) => k.slice(prefix.length + 1)).sort();
  }
}
