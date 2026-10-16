// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretBox } from './secret-box.js';
import { hashToken, randomToken, safeEqual } from './tokens.js';

describe('SecretBox', () => {
  const box = SecretBox.single(randomBytes(32));

  it('round-trips with the same AAD', () => {
    const sealed = box.seal('JBSWY3DPEHPK3PXP', 'totp:user-1');
    expect(sealed.ciphertext).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.open(sealed, 'totp:user-1')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('rejects a ciphertext moved to another record', () => {
    const sealed = box.seal('secret', 'totp:user-1');
    expect(() => box.open(sealed, 'totp:user-2')).toThrow();
  });

  it('rejects tampered ciphertexts', () => {
    const sealed = box.seal('secret', 'x');
    const bytes = Buffer.from(sealed.ciphertext, 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    expect(() => box.open({ ...sealed, ciphertext: bytes.toString('base64') }, 'x')).toThrow();
  });

  it('uses a fresh nonce for every seal', () => {
    expect(box.seal('a', 'x').nonce).not.toBe(box.seal('a', 'x').nonce);
  });

  it('decrypts with older key versions after rotation', () => {
    const k1 = randomBytes(32);
    const old = new SecretBox(new Map([[1, k1]]), 1).seal('v', 'aad');
    const rotated = new SecretBox(
      new Map([
        [1, k1],
        [2, randomBytes(32)],
      ]),
      2,
    );
    expect(rotated.open(old, 'aad')).toBe('v');
    expect(rotated.seal('v', 'aad').keyVersion).toBe(2);
  });
});

describe('tokens', () => {
  it('are 256-bit and unique', () => {
    const token = randomToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(randomToken()).not.toBe(token);
  });

  it('hash deterministically and never equal the token', () => {
    const token = randomToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
  });

  it('compare in constant time with length mismatch handling', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
