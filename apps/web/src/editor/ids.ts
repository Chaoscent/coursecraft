// SPDX-License-Identifier: Apache-2.0
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Short random id, valid for course-model ids. */
export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}-${Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')}`;
}
