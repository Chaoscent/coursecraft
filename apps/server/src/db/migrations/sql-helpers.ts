// SPDX-License-Identifier: Apache-2.0
/**
 * The single reviewed file allowed to use Kysely's `sql`. Anything added here
 * needs a security review. Identifiers are accepted only as TrustedIdentifier,
 * which can be created from string literals in code but never from runtime
 * strings.
 */
import { sql, type RawBuilder } from 'kysely';

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
