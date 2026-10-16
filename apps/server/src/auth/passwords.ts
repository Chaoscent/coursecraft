// SPDX-License-Identifier: Apache-2.0
import { hash, verify } from '@node-rs/argon2';

/** Argon2id; OWASP minimum is m=19 MiB, t=2, p=1. */
const OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(stored: string | null, password: string): Promise<boolean> {
  // Unknown users still cost one verification, so timing does not reveal accounts.
  const target = stored ?? (await dummyHash());
  try {
    return (await verify(target, password)) && stored !== null;
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;
function dummyHash(): Promise<string> {
  dummy ??= hash('lernwerk-timing-equalizer', OPTIONS);
  return dummy;
}
