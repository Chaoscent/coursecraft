// SPDX-License-Identifier: Apache-2.0
// Security audit (SECURITY_AUDIT.md, F-21 / P7): the master key can be rotated.
// A sealed secret written with key version 1 is re-sealed with the current key
// by `coursecraft rotate-master-key`, so the retired key can then be removed.
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resealTenantSecrets } from '../../apps/server/src/cli/rotate-master-key.js';
import { SecretBox } from '../../apps/server/src/crypto/secret-box.js';
import { totpAad } from '../../apps/server/src/modules/auth/service.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

describe('F-21: master-key rotation', () => {
  it('a ciphertext from an older key version still opens after a newer key is added', () => {
    const [k1, k2] = [randomBytes(32), randomBytes(32)];
    const v1 = new SecretBox(new Map([[1, k1]]), 1);
    const sealedV1 = v1.seal('secret-value', 'aad');
    expect(sealedV1.keyVersion).toBe(1);
    const ring = new SecretBox(
      new Map([
        [1, k1],
        [2, k2],
      ]),
      2,
    );
    // Old ciphertext opens with the ring; new seals use the current key.
    expect(ring.open(sealedV1, 'aad')).toBe('secret-value');
    expect(ring.seal('x', 'aad').keyVersion).toBe(2);
  });

  it('rotate-master-key re-seals stored secrets so a retired key can be dropped', async () => {
    const user = await t.createUser(['learner']);
    // Seal a TOTP secret with the app's current key (version 1).
    await t.ctx.db
      .updateTable('users')
      .set({ totp_secret: JSON.stringify(t.ctx.box.seal('totp-seed', totpAad(user.id))), totp_last_step: 1 })
      .where('id', '=', user.id)
      .execute();
    const before = await t.ctx.db
      .selectFrom('users')
      .select('totp_secret')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(before.totp_secret?.keyVersion).toBe(1);

    // A ring with a new current key (version 2); the old key stays only to open old data.
    const newKey = randomBytes(32);
    const ring = new SecretBox(
      new Map([
        [1, t.ctx.config.masterKey],
        [2, newKey],
      ]),
      2,
    );
    const resealed = await resealTenantSecrets(t.ctx.db, ring);
    expect(resealed).toBeGreaterThanOrEqual(1);

    const after = await t.ctx.db
      .selectFrom('users')
      .select('totp_secret')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(after.totp_secret?.keyVersion).toBe(2);
    // The retired key (version 1) can now be removed: the new key alone opens it.
    const newOnly = new SecretBox(new Map([[2, newKey]]), 2);
    expect(newOnly.open(after.totp_secret!, totpAad(user.id))).toBe('totp-seed');
  });
});
