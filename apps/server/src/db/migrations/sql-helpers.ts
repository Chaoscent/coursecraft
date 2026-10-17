// SPDX-License-Identifier: Apache-2.0
/**
 * The single reviewed file allowed to use Kysely's `sql`. Anything added here
 * needs a security review. Identifiers are accepted only as TrustedIdentifier,
 * which can be created from string literals in code but never from runtime
 * strings.
 */
import { sql, type Kysely, type RawBuilder } from 'kysely';

declare const trusted: unique symbol;
export type TrustedIdentifier = string & { readonly [trusted]: true };

/** Resolves to `never` for the wide `string` type, so only literals type-check. */
type Literal<T extends string> = string extends T ? never : T;

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export function ident<const T extends string>(name: Literal<T>): TrustedIdentifier {
  if (!IDENTIFIER.test(name)) throw new Error(`Invalid SQL identifier: ${name}`);
  return name as string as TrustedIdentifier;
}

export const now = (): RawBuilder<Date> => sql<Date>`now()`;

export const randomUuid = (): RawBuilder<string> => sql<string>`gen_random_uuid()`;

/** Default for a JSON column holding an empty object. */
export const emptyJsonObject = (): RawBuilder<unknown> => sql`'{}'::jsonb`;

/** Lower-case unique index expression, e.g. for e-mail addresses. */
export const lower = (column: TrustedIdentifier): RawBuilder<string> =>
  sql<string>`lower(${sql.ref(column)})`;

/** CHECK expression `column IN (...)` for values defined as code constants. */
export const oneOf = (column: TrustedIdentifier, values: readonly string[]): RawBuilder<boolean> =>
  sql<boolean>`${sql.ref(column)} in (${sql.join(values.map((v) => sql.lit(v)))})`;

/** CHECK expression: exactly one of two columns is set. */
export const exactlyOne = (a: TrustedIdentifier, b: TrustedIdentifier): RawBuilder<boolean> =>
  sql<boolean>`num_nonnulls(${sql.ref(a)}, ${sql.ref(b)}) = 1`;

/** CHECK expression `column = value` for a numeric constant (singleton tables). */
export const equals = (column: TrustedIdentifier, value: number): RawBuilder<boolean> =>
  sql<boolean>`${sql.ref(column)} = ${sql.lit(value)}`;

/**
 * Makes a table append-only for a role (audit log). Skipped when the role does
 * not exist, e.g. in development databases without the role setup.
 */
export async function revokeWrites<DB>(
  db: Kysely<DB>,
  table: TrustedIdentifier,
  role: TrustedIdentifier,
): Promise<void> {
  const result = await sql<{
    n: number;
  }>`select count(*)::int as n from pg_roles where rolname = ${role}`.execute(db);
  if (result.rows[0]?.n) {
    await sql`revoke update, delete, truncate on ${sql.table(table)} from ${sql.id(role)}`.execute(db);
  }
}
