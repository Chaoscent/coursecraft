// SPDX-License-Identifier: Apache-2.0
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random token, base64url (43 characters). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Hash for storing tokens: only the hash ever reaches the database. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function hmac(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
