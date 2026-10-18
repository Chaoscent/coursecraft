// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { ident, oneOf } from './sql-helpers.js';

/** Sign-in through a reverse proxy that authenticates Windows accounts (Kerberos/NTLM). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('sso_providers').dropConstraint('sso_providers_kind_check').execute();
  await db.schema
    .alterTable('sso_providers')
    .addCheckConstraint('sso_providers_kind_check', oneOf(ident('kind'), ['oidc', 'saml', 'ldap', 'proxy']))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('sso_providers').dropConstraint('sso_providers_kind_check').execute();
  await db.schema
    .alterTable('sso_providers')
    .addCheckConstraint('sso_providers_kind_check', oneOf(ident('kind'), ['oidc', 'saml', 'ldap']))
    .execute();
}
