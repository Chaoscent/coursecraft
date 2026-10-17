// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { ident, oneOf } from './sql-helpers.js';

const KINDS = ['oidc', 'saml', 'ldap'] as const;

/** Directory (LDAP / Active Directory) sign-in is a third kind of identity provider. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('sso_providers').dropConstraint('sso_providers_kind_check').execute();
  await db.schema
    .alterTable('sso_providers')
    .addCheckConstraint('sso_providers_kind_check', oneOf(ident('kind'), KINDS))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('sso_providers').dropConstraint('sso_providers_kind_check').execute();
  await db.schema
    .alterTable('sso_providers')
    .addCheckConstraint('sso_providers_kind_check', oneOf(ident('kind'), ['oidc', 'saml']))
    .execute();
}
