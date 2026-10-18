// SPDX-License-Identifier: Apache-2.0
import { createHash, createHmac } from 'node:crypto';

const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding as AWS wants it (`!'()*` encoded too); slashes stay when `keepSlash`. */
export function awsEncode(value: string, keepSlash = false): string {
  const encoded = encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return keepSlash ? encoded.replaceAll('%2F', '/') : encoded;
}

export interface SigningInput {
  method: string;
  /** Already encoded absolute path, e.g. `/bucket/some/key`. */
  path: string;
  query: Record<string, string>;
  /** Lower-case header names; must include `host` and `x-amz-date`. */
  headers: Record<string, string>;
  /** Hex SHA-256 of the body, or `UNSIGNED-PAYLOAD`. */
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** `YYYYMMDDTHHMMSSZ` */
  amzDate: string;
}

/** AWS Signature Version 4 `Authorization` header value. */
export function authorization(input: SigningInput): string {
  const day = input.amzDate.slice(0, 8);
  const names = Object.keys(input.headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${(input.headers[n] ?? '').trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalQuery = Object.keys(input.query)
    .sort()
    .map((k) => `${awsEncode(k)}=${awsEncode(input.query[k] ?? '')}`)
    .join('&');
  const canonicalRequest = [
    input.method,
    input.path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', input.amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), input.service),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

export { sha256Hex };
