// SPDX-License-Identifier: Apache-2.0
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for secrets at rest (TOTP secrets, API keys, SMTP passwords).
 * The AAD binds a ciphertext to its purpose and record, so a ciphertext
 * copied into another row or column fails to decrypt.
 */
export interface Sealed {
  ciphertext: string;
  nonce: string;
  keyVersion: number;
}

export class SecretBox {
  readonly #keys: ReadonlyMap<number, Buffer>;
  readonly #current: number;

  constructor(keys: ReadonlyMap<number, Buffer>, currentVersion: number) {
    if (!keys.has(currentVersion)) throw new Error('Current key version missing');
    for (const key of keys.values()) if (key.length !== 32) throw new Error('Keys must be 32 bytes');
    this.#keys = keys;
    this.#current = currentVersion;
  }

  static single(key: Buffer): SecretBox {
    return new SecretBox(new Map([[1, key]]), 1);
  }

  seal(plaintext: string, aad: string): Sealed {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key(this.#current), nonce);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    return {
      ciphertext: body.toString('base64'),
      nonce: nonce.toString('base64'),
      keyVersion: this.#current,
    };
  }

  open(sealed: Sealed, aad: string): string {
    const body = Buffer.from(sealed.ciphertext, 'base64');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.#key(sealed.keyVersion),
      Buffer.from(sealed.nonce, 'base64'),
    );
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(body.subarray(body.length - 16));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString(
      'utf8',
    );
  }

  #key(version: number): Buffer {
    const key = this.#keys.get(version);
    if (!key) throw new Error(`Unknown key version ${version}`);
    return key;
  }
}
