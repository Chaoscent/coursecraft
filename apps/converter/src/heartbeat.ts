// SPDX-License-Identifier: Apache-2.0
import { statSync, writeFileSync } from 'node:fs';

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_MAX_AGE_MS = 30_000;

export function beat(file: string): void {
  writeFileSync(file, String(Date.now()));
}

/** True when the worker wrote its heartbeat recently. */
export function isAlive(file: string, now = Date.now()): boolean {
  try {
    return now - statSync(file).mtimeMs < HEARTBEAT_MAX_AGE_MS;
  } catch {
    return false;
  }
}
