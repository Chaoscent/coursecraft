// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import type { SecretBox, Sealed } from '../crypto/secret-box.js';
import type { Database } from '../db/schema.js';
import { totpAad } from '../modules/auth/service.js';
import { providerAad, userKeyAad } from '../modules/ai/service.js';
import { smtpAad } from '../modules/mail/service.js';
import { secretAad } from '../modules/sso/service.js';

/**
 * Re-seals every persistent sealed secret of the current organisation with the
 * current master key (SECURITY_AUDIT.md F-21). Each value is opened with its
 * own key version (from the key ring) and sealed again with the current key
 * and the same AAD, so after rotating every ciphertext uses the new key and
 * the retired keys can be removed. Runs inside a tenant scope (RLS); the
 * caller iterates organisations.
 */
export async function resealTenantSecrets(app: Kysely<Database>, box: SecretBox): Promise<number> {
  const reseal = (sealed: Sealed, aad: string): string =>
    JSON.stringify(box.seal(box.open(sealed, aad), aad));
  let count = 0;

  for (const u of await app
    .selectFrom('users')
    .select(['id', 'totp_secret'])
    .where('totp_secret', 'is not', null)
    .execute()) {
    if (!u.totp_secret) continue;
    await app
      .updateTable('users')
      .set({ totp_secret: reseal(u.totp_secret, totpAad(u.id)) })
      .where('id', '=', u.id)
      .execute();
    count += 1;
  }

  for (const p of await app
    .selectFrom('sso_providers')
    .select(['id', 'secret'])
    .where('secret', 'is not', null)
    .execute()) {
    if (!p.secret) continue;
    await app
      .updateTable('sso_providers')
      .set({ secret: reseal(p.secret, secretAad(p.id)) })
      .where('id', '=', p.id)
      .execute();
    count += 1;
  }

  for (const p of await app
    .selectFrom('ai_providers')
    .select(['id', 'api_key'])
    .where('api_key', 'is not', null)
    .execute()) {
    if (!p.api_key) continue;
    await app
      .updateTable('ai_providers')
      .set({ api_key: reseal(p.api_key, providerAad(p.id)) })
      .where('id', '=', p.id)
      .execute();
    count += 1;
  }

  for (const k of await app
    .selectFrom('ai_user_keys')
    .select(['user_id', 'provider_id', 'api_key'])
    .execute()) {
    await app
      .updateTable('ai_user_keys')
      .set({ api_key: reseal(k.api_key, userKeyAad(k.user_id, k.provider_id)) })
      .where('user_id', '=', k.user_id)
      .where('provider_id', '=', k.provider_id)
      .execute();
    count += 1;
  }

  const smtp = await app.selectFrom('settings').select('value').where('key', '=', 'smtp').executeTakeFirst();
  const value = smtp?.value as { password?: Sealed | null } | undefined;
  if (value?.password) {
    value.password = box.seal(box.open(value.password, smtpAad()), smtpAad());
    await app
      .updateTable('settings')
      .set({ value: JSON.stringify(value) })
      .where('key', '=', 'smtp')
      .execute();
    count += 1;
  }

  return count;
}
